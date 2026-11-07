import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { AUTH_SESSION_COOKIE, validateSession } from "./auth";
import { database } from "./database";

type ApiEnvironment = {
  Variables: {
    userId: number;
    sessionAdmin?: boolean;
    profileAdmin?: boolean;
    permissionGroupUuid?: string;
  };
};
type ApiContext = Context<ApiEnvironment>;

interface BearerAuthAccess {
  profileFromCookie: (context: ApiContext) => Promise<number>;
  setDelegatedProfileAdmin: (context: ApiContext, userId: number) => Promise<void>;
}

export function bearerSessionToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  return match?.[1];
}

export function authSessionToken(
  context: ApiContext,
  parseCookies: (header: string | undefined) => Record<string, string>,
): string | undefined {
  return bearerSessionToken(context.req.header("authorization"))
    ?? parseCookies(context.req.header("cookie"))[AUTH_SESSION_COOKIE];
}

export function isAuthFreePath(path: string): boolean {
  return path.startsWith("/auth") || path === "/config";
}

export async function persistSessionProfile(
  context: ApiContext,
  userId: number,
  profileCookie: string,
): Promise<boolean> {
  const bearer = bearerSessionToken(context.req.header("authorization"));
  if (!bearer) {
    context.header("Set-Cookie", profileCookie);
    // Pin the profile server-side so editing the unsigned profile cookie cannot escape child lock.
    const token = getCookie(context, AUTH_SESSION_COOKIE);
    if (token) await database.prepare("UPDATE auth_sessions SET user_id = ? WHERE token = ? AND scope = 'account'").run(userId, token);
    return true;
  }
  const updated = await database.prepare("UPDATE auth_sessions SET user_id = ?, scope = 'account' WHERE token = ?")
    .run(userId, bearer);
  return updated.changes === 1;
}

export async function revalidateBearerRequest(
  context: ApiContext,
  expectedUserId: number,
  profileFromCookie: (context: ApiContext) => Promise<number>,
): Promise<boolean | undefined> {
  const bearer = bearerSessionToken(context.req.header("authorization"));
  if (!bearer) return undefined;
  const session = await validateSession(bearer, { renew: true });
  if (!session) return false;
  const userId = session.scope === "account" ? session.user_id ?? await profileFromCookie(context) : session.user_id ?? 0;
  return userId === expectedUserId;
}

export async function authenticateBearerRequest(
  context: ApiContext,
  access: BearerAuthAccess,
): Promise<"absent" | "authenticated" | "invalid"> {
  const authorization = context.req.header("authorization");
  if (!authorization?.match(/^Bearer\b/i)) return "absent";
  const bearer = bearerSessionToken(authorization);
  if (!bearer) {
    context.set("userId", 0);
    return "invalid";
  }

  const session = await validateSession(bearer, { renew: true });
  if (!session) {
    context.set("userId", 0);
    return "invalid";
  }
  const userId = session.scope === "account"
    ? session.user_id ?? await access.profileFromCookie(context)
    : session.user_id ?? 0;
  context.set("userId", userId);
  context.set("sessionAdmin", session.is_admin);
  if (session.permission_group_uuid) context.set("permissionGroupUuid", session.permission_group_uuid);
  if (session.scope === "profile") await access.setDelegatedProfileAdmin(context, userId);
  return "authenticated";
}
