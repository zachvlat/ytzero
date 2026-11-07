// Authentication layer for ytzero.
//
// The app supports five auth methods (settings key `auth_method`):
//   none         — no auth; the `ytzero_profile` cookie selects a profile (legacy).
//   shared       — one household login (password and/or passkey); free profile switching.
//   per_profile  — each profile has its own login; switching profile = re-login.
//   oidc         — external IdP; mapped (identity->one profile) or gateway (SSO->picker).
//   proxy_header — a trusted reverse proxy sets a username header matched to a profile.
//
// Profile id stays the unit of isolation everywhere else; this module just turns
// "an authenticated request" into "an active profile id" for the route middleware.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import * as oidc from "openid-client";
import { getConnInfo } from "hono/bun";
import { getSetting } from "./db";
import { database } from "./database";
import { assignDefaultPermissionGroup } from "./accessControl";
import {
  environmentAuthMethod,
  environmentAuthPasswordConfigured,
  verifyEnvironmentAuthPassword,
} from "./authEnvironment";
import { externalRoleMappingConfig, matchedExternalRoleUuid, normalizeExternalGroups } from "./externalRoleMappings";

export type AuthMethod = "none" | "shared" | "per_profile" | "oidc" | "proxy_header";

export function authMethod(): AuthMethod {
  if (process.env.YTZERO_AUTH_DISABLE === "1") return "none"; // emergency unlock
  const environmentMethod = environmentAuthMethod();
  if (environmentMethod) return environmentMethod;
  const m = getSetting("auth_method") ?? "none";
  return (["none", "shared", "per_profile", "oidc", "proxy_header"].includes(m) ? m : "none") as AuthMethod;
}

export async function hashPassword(password: string) {
  return Bun.password.hash(password);
}
export async function verifyPassword(password: string, hash: string) {
  if (!hash) return false;
  return Bun.password.verify(password, hash);
}

function sharedAuthUsername(): string {
  return environmentAuthMethod() ? "" : getSetting("auth_shared_username") || "";
}

function sharedPasswordConfigured(): boolean {
  return environmentAuthMethod()
    ? environmentAuthPasswordConfigured()
    : Boolean(getSetting("auth_shared_password_hash"));
}

async function verifySharedPassword(password: string): Promise<boolean> {
  return environmentAuthMethod()
    ? verifyEnvironmentAuthPassword(password)
    : verifyPassword(password, getSetting("auth_shared_password_hash") || "");
}

export const sharedAuth = {
  environmentControlled: () => Boolean(environmentAuthMethod()),
  hashPassword,
  passwordConfigured: sharedPasswordConfigured,
  username: sharedAuthUsername,
  verifyHash: verifyPassword,
  verifyPassword: verifySharedPassword,
};

// ---------- request origin / RP id (for WebAuthn and OIDC redirect URIs) ----------

export function requestOrigin(c: any): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

// The browser's actual web origin, taken from the request's Origin header (sent
// on fetch/XHR). In dev the UI runs on a different port than the API and proxies
// /api through, so WebAuthn must validate against the browser origin — not the
// API's own host. Falls back to the derived origin for non-CORS requests.
export function webauthnOrigin(c: any): string {
  return c.req.header("origin") || requestOrigin(c);
}

export function rpId(c: any): string {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  try {
    return new URL(webauthnOrigin(c)).hostname;
  } catch {
    return "localhost";
  }
}

// ---------- sessions (DB-backed, survive restart) ----------

export const AUTH_SESSION_COOKIE = "ytzero_session";
export const AUTH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SESSION_TTL_MS = AUTH_SESSION_TTL_SECONDS * 1000;

export type SessionScope = "account" | "profile";

export async function createSession(userId: number | null, scope: SessionScope, isAdmin = false, permissionGroupUuid: string | null = null): Promise<string> {
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await database.prepare(
    "INSERT INTO auth_sessions (token, user_id, scope, is_admin, permission_group_uuid, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ).run(token, userId, scope, isAdmin ? 1 : 0, permissionGroupUuid, expires);
  return token;
}

export async function validateSession(
  token: string | undefined,
  options: { renew?: boolean } = {},
): Promise<{ user_id: number | null; scope: SessionScope; is_admin: boolean; permission_group_uuid: string | null } | null> {
  if (!token) return null;
  const row = await database
    .prepare("SELECT user_id, scope, is_admin, permission_group_uuid, expires_at FROM auth_sessions WHERE token = ?")
    .get<{ user_id: number | null; scope: SessionScope; is_admin: number; permission_group_uuid: string | null; expires_at: string }>(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await database.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
    return null;
  }
  if (options.renew) {
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await database.prepare("UPDATE auth_sessions SET expires_at = ?, last_seen = datetime('now') WHERE token = ?").run(expires, token);
  } else {
    await database.prepare("UPDATE auth_sessions SET last_seen = datetime('now') WHERE token = ?").run(token);
  }
  return { user_id: row.user_id, scope: row.scope, is_admin: row.is_admin === 1, permission_group_uuid: row.permission_group_uuid ?? null };
}

export async function destroySession(token: string | undefined) {
  if (token) await database.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
}

export function authSessionCookie(token: string) {
  return `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}; SameSite=Lax; HttpOnly`;
}
export function clearAuthSessionCookie() {
  return `${AUTH_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
}

// ---------- short-lived challenge / state store (WebAuthn + OIDC) ----------

type Flow = { value: string; userId: number | null; nonce?: string };
const FLOW_TTL_MS = 5 * 60 * 1000;
const databaseTimestamp = (milliseconds: number) => new Date(milliseconds).toISOString().replace("T", " ").slice(0, 19);

async function putFlow(value: string, userId: number | null, nonce?: string): Promise<string> {
  const id = crypto.randomUUID();
  const expiresAt = databaseTimestamp(Date.now() + FLOW_TTL_MS);
  await database.prepare("INSERT INTO auth_flows (id, value, user_id, nonce, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, value, userId, nonce ?? null, expiresAt);
  // Opportunistic bounded-state cleanup; correctness never depends on it.
  void database.prepare("DELETE FROM auth_flows WHERE expires_at <= datetime('now')").run().catch(() => {});
  return id;
}
async function takeFlow(id: string | undefined): Promise<Flow | null> {
  if (!id) return null;
  // DELETE ... RETURNING makes a challenge single-use even when two callbacks
  // reach different replicas concurrently. Compare expiry in the database so
  // UTC text timestamps are never interpreted in the process-local timezone.
  const flow = await database.prepare("DELETE FROM auth_flows WHERE id = ? AND expires_at > datetime('now') RETURNING value, user_id, nonce")
    .get<{ value: string; user_id: number | null; nonce: string | null }>(id);
  if (!flow) return null;
  return { value: flow.value, userId: flow.user_id, ...(flow.nonce ? { nonce: flow.nonce } : {}) };
}

// ---------- WebAuthn / passkeys ----------

type CredRow = {
  id: number;
  user_id: number | null;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  label: string | null;
  created_at: string;
};

async function credsFor(userId: number | null): Promise<CredRow[]> {
  const rows =
    userId === null
      ? await database.prepare("SELECT * FROM webauthn_credentials WHERE user_id IS NULL").all<CredRow>()
      : await database.prepare("SELECT * FROM webauthn_credentials WHERE user_id = ?").all<CredRow>(userId);
  return rows;
}

export async function hasPasskeys(userId: number | null): Promise<boolean> {
  return (await credsFor(userId)).length > 0;
}

export async function listPasskeys(userId: number | null) {
  return (await credsFor(userId)).map((r) => ({ id: r.id, label: r.label ?? null, created_at: r.created_at }));
}

export async function deletePasskey(id: number, userId: number | null) {
  if (userId === null) await database.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id IS NULL").run(id);
  else await database.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?").run(id, userId);
}

// Registration: create options for the given account/profile (userId NULL = shared).
export async function passkeyRegisterOptions(c: any, userId: number | null, userName: string) {
  const existing = await credsFor(userId);
  const options = await generateRegistrationOptions({
    rpName: getSetting("app_name") || "YT Zero",
    rpID: rpId(c),
    userName,
    userID: new TextEncoder().encode(String(userId ?? "shared")),
    attestationType: "none",
    excludeCredentials: existing.map((cr) => ({ id: cr.credential_id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  const flowId = await putFlow(options.challenge, userId);
  return { options, flowId };
}

export async function passkeyRegisterVerify(
  c: any,
  flowId: string | undefined,
  response: RegistrationResponseJSON,
  label?: string
) {
  const flow = await takeFlow(flowId);
  if (!flow) throw new Error("challenge expired");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: flow.value,
    expectedOrigin: webauthnOrigin(c),
    expectedRPID: rpId(c),
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error("verification failed");
  const cred = verification.registrationInfo.credential;
  await database.prepare(
    "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    flow.userId,
    cred.id,
    Buffer.from(cred.publicKey),
    cred.counter ?? 0,
    cred.transports ? JSON.stringify(cred.transports) : null,
    label ?? null
  );
  return { user_id: flow.userId };
}

// Login: options can target a specific profile (per_profile) or any (shared = NULL,
// or "all profiles" for discovery). We allow credentials across the relevant scope.
export async function passkeyLoginOptions(c: any, userId: number | null) {
  const creds = userId === null ? await allLoginCreds() : await credsFor(userId);
  const options = await generateAuthenticationOptions({
    rpID: rpId(c),
    userVerification: "preferred",
    allowCredentials: creds.map((cr) => ({
      id: cr.credential_id,
      transports: cr.transports ? JSON.parse(cr.transports) : undefined,
    })),
  });
  const flowId = await putFlow(options.challenge, userId);
  return { options, flowId };
}

// For shared login the credential has user_id NULL; for per_profile/oidc-mapped
// login the resolved profile is whatever owns the credential.
async function allLoginCreds(): Promise<CredRow[]> {
  const method = authMethod();
  if (method === "shared") return credsFor(null);
  return database.prepare("SELECT * FROM webauthn_credentials WHERE user_id IS NOT NULL").all<CredRow>();
}

export async function passkeyLoginVerify(
  c: any,
  flowId: string | undefined,
  response: AuthenticationResponseJSON
): Promise<{ user_id: number | null }> {
  const flow = await takeFlow(flowId);
  if (!flow) throw new Error("challenge expired");
  const cred = await database
    .prepare("SELECT * FROM webauthn_credentials WHERE credential_id = ?")
    .get<CredRow>(response.id);
  if (!cred) throw new Error("unknown credential");
  // Passkeys only work while passkey methods are active, and a shared (ownerless) key must not open whole-account access under 'per_profile'.
  const method = authMethod();
  if ((method !== "shared" && method !== "per_profile") || (method === "per_profile" && cred.user_id === null)) {
    throw new Error("credential not valid for the current sign-in method");
  }
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: flow.value,
    expectedOrigin: webauthnOrigin(c),
    expectedRPID: rpId(c),
    credential: {
      id: cred.credential_id,
      publicKey: new Uint8Array(cred.public_key),
      counter: cred.counter,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    },
  });
  if (!verification.verified) throw new Error("verification failed");
  await database.prepare("UPDATE webauthn_credentials SET counter = ? WHERE id = ?").run(
    verification.authenticationInfo.newCounter,
    cred.id
  );
  return { user_id: cred.user_id };
}

// ---------- OIDC ----------

let oidcConfigCache: { key: string; config: oidc.Configuration } | null = null;

async function getOidcConfig(): Promise<oidc.Configuration> {
  const issuer = getSetting("auth_oidc_issuer") || "";
  const clientId = getSetting("auth_oidc_client_id") || "";
  const clientSecret = getSetting("auth_oidc_client_secret") || "";
  if (!issuer || !clientId) throw new Error("OIDC not configured");
  const key = `${issuer}|${clientId}|${clientSecret}`;
  if (oidcConfigCache?.key === key) return oidcConfigCache.config;
  const config = await oidc.discovery(new URL(issuer), clientId, clientSecret || undefined);
  oidcConfigCache = { key, config };
  return config;
}

export function invalidateOidcConfig() {
  oidcConfigCache = null;
}

function oidcRedirectUri(c: any) {
  return `${requestOrigin(c)}/api/auth/oidc/callback`;
}

// openid-client derives the redirect_uri used by the token request from the
// callback URL passed to authorizationCodeGrant. c.req.url can contain the
// app's internal http origin behind a TLS-terminating proxy, so replace only
// its origin with the same public origin used for the authorization request.
function oidcCallbackUrl(c: any, currentUrl: string): URL {
  const incoming = new URL(currentUrl);
  return new URL(`${incoming.pathname}${incoming.search}`, `${requestOrigin(c)}/`);
}

// Probe the issuer's discovery document; used by the setup wizard's "test" button.
export async function testOidc(): Promise<{ ok: boolean; authorization_endpoint?: string; token_endpoint?: string; error?: string }> {
  try {
    const config = await getOidcConfig();
    const meta = config.serverMetadata();
    return { ok: true, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "discovery failed" };
  }
}

export async function oidcAuthUrl(c: any): Promise<{ url: string; flowId: string }> {
  const config = await getOidcConfig();
  const scope = getSetting("auth_oidc_scopes") || "openid profile email";
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: oidcRedirectUri(c),
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  // Store the verifier keyed by a flow id we put in a cookie; correlate on callback.
  const flowId = await putFlow(JSON.stringify({ codeVerifier, state }), null, nonce);
  return { url: url.href, flowId };
}

// Read the configured groups claim from the ID token, or userinfo as a
// fallback. The same normalized list feeds admin and role mappings.
async function resolveOidcGroups(config: oidc.Configuration, tokens: any, claims: any): Promise<string[]> {
  const groupsClaim = getSetting("auth_oidc_groups_claim") || "groups";
  let groups = claims?.[groupsClaim];
  if (groups === undefined && tokens?.access_token && claims?.sub) {
    try {
      const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
      groups = (info as any)?.[groupsClaim];
    } catch {
      // userinfo unavailable — fall through with no groups
    }
  }
  return normalizeExternalGroups(groups);
}

// Returns the mapped/auto-created profile id (null for gateway mode), whether
// the identity's groups grant admin, and the session-only mapped role.
export async function oidcCallback(
  c: any,
  flowId: string | undefined,
  currentUrl: string
): Promise<{ user_id: number | null; mode: "mapped" | "gateway"; is_admin: boolean; permission_group_uuid: string | null }> {
  const flow = await takeFlow(flowId);
  if (!flow) throw new Error("login flow expired");
  const { codeVerifier, state } = JSON.parse(flow.value) as { codeVerifier: string; state: string };
  const config = await getOidcConfig();
  const tokens = await oidc.authorizationCodeGrant(config, oidcCallbackUrl(c, currentUrl), {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: flow.nonce,
  });
  const claims = tokens.claims() ?? {};
  const mode = (getSetting("auth_oidc_mode") || "mapped") as "mapped" | "gateway";
  const groups = await resolveOidcGroups(config, tokens, claims);
  const adminGroup = (getSetting("auth_oidc_admin_group") || "").trim();
  const is_admin = Boolean(adminGroup) && groups.includes(adminGroup);

  if (mode === "gateway") return { user_id: null, mode, is_admin, permission_group_uuid: null };

  // mapped: resolve the configured claim to a profile.
  const claimName = getSetting("auth_oidc_claim") || "preferred_username";
  const claimValue = String((claims as any)[claimName] ?? (claims as any).sub ?? "");
  if (!claimValue) throw new Error("identity claim missing");

  let row = await database.prepare("SELECT id FROM users WHERE oidc_subject = ?").get<{ id: number }>(claimValue);
  if (!row) {
    if (getSetting("auth_oidc_autocreate") === "1") {
      const nextOrder = (await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM users").get<{ n: number }>())!.n;
      const name = String((claims as any).name ?? (claims as any).preferred_username ?? claimValue);
      const created = await database
        .prepare("INSERT INTO users (name, avatar_color, oidc_subject, sort_order, portable_uuid) VALUES (?, ?, ?, ?, ?) RETURNING id")
        .get<{ id: number }>(name, "#7c5cff", claimValue, nextOrder, crypto.randomUUID());
      if (!created) throw new Error("profile creation did not return an id");
      await assignDefaultPermissionGroup(created.id);
      row = created;
    } else {
      throw new Error("no profile mapped to this identity");
    }
  }
  const permission_group_uuid = matchedExternalRoleUuid(externalRoleMappingConfig("auth_oidc_role_mappings"), groups);
  return { user_id: row.id, mode, is_admin, permission_group_uuid };
}

// ---------- proxy header ----------

// The proxy header is only believed from the proxy itself. Default: loopback and private
// networks (Docker, LAN). YTZERO_TRUSTED_PROXIES="10.0.0.5,::1" narrows it to exact peer IPs.
export function isTrustedProxyPeer(address: string | undefined, trusted = process.env.YTZERO_TRUSTED_PROXIES): boolean {
  if (!address) return false;
  const ip = address.replace(/^::ffff:/i, "");
  const list = trusted?.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (list?.length) return list.includes(ip);
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === "::1" || /^f[cd]/i.test(ip);
}

function requestPeerAddress(c: any): string | undefined {
  try { return getConnInfo(c).remote.address; } catch { return undefined; }
}

export async function resolveProxyUser(c: any): Promise<number | null> {
  if (!isTrustedProxyPeer(requestPeerAddress(c))) return null;
  const headerName = (getSetting("auth_proxy_header") || "Remote-User").toLowerCase();
  const value = c.req.header(headerName);
  if (!value) return null;
  const row = await database.prepare("SELECT id FROM users WHERE proxy_match = ?").get<{ id: number }>(value);
  return row?.id ?? null;
}

export function proxyHeaderValue(c: any): string | null {
  const headerName = (getSetting("auth_proxy_header") || "Remote-User").toLowerCase();
  return c.req.header(headerName) ?? null;
}

export function proxyGroupsHeaderValue(c: any): string | null {
  const headerName = (getSetting("auth_proxy_groups_header") || "Remote-Groups").toLowerCase();
  return c.req.header(headerName) ?? null;
}

export function resolveProxyPermissionGroupUuid(c: any): string | null {
  return matchedExternalRoleUuid(
    externalRoleMappingConfig("auth_proxy_role_mappings"),
    normalizeExternalGroups(proxyGroupsHeaderValue(c)),
  );
}
