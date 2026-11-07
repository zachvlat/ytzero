const { api } = await import("../src/routes");
const { db, setSetting } = await import("../src/db");
const { AUTH_SESSION_COOKIE, createSession } = await import("../src/auth");

const profile = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid, proxy_match) VALUES(?, ?, ?, ?, ?) RETURNING id",
).get("Mapped profile", "#7c5cff", 1, crypto.randomUUID(), "mapped-user") as { id: number };
db.prepare("UPDATE users SET proxy_match=? WHERE id=1").run("proxy-owner");

async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return api.request(`http://localhost${path}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 0 }) });
}

const ownerHeaders = { Cookie: "ytzero_profile=1" };
const initial = await (await request("/access-control", "GET", undefined, ownerHeaders)).json() as any;
const manualRole = initial.groups.find((group: any) => group.name === "Restricted");
const allowedRoleResponse = await request("/access-control/groups", "POST", { name: "External tags", permissions: ["tags"] }, ownerHeaders);
const allowedRole = ((await allowedRoleResponse.json() as any).groups as any[]).find((group) => group.name === "External tags");
await request(`/access-control/profiles/${profile.id}`, "PUT", { group_id: manualRole.id, overrides: { tags: "deny" } }, ownerHeaders);

const mappingConfig = {
  mappings: [
    { group: "parents", role_uuid: allowedRole.portable_uuid },
    { group: "children", role_uuid: manualRole.portable_uuid },
  ],
  fallback_role_uuid: null,
};
const saveConfig = await request("/auth/config", "PUT", {
  proxy: { groups_header: "Remote-Groups", role_mappings: mappingConfig },
  oidc: { role_mappings: mappingConfig },
}, ownerHeaders);
const config = await (await request("/auth/config", "GET", undefined, ownerHeaders)).json() as any;

await setSetting("auth_method", "proxy_header");
const proxyPermissions = await (await request("/profile-permissions", "GET", undefined, { "Remote-User": "mapped-user", "Remote-Groups": "parents" })).json() as any;
const proxyManual = await request("/tags", "POST", { name: "proxy-manual" }, { "Remote-User": "mapped-user" });
const proxyMapped = await request("/tags", "POST", { name: "proxy-mapped" }, { "Remote-User": "mapped-user", "Remote-Groups": "parents" });
const proxyPriority = await request("/tags", "POST", { name: "proxy-priority" }, { "Remote-User": "mapped-user", "Remote-Groups": "children, parents" });

const fallbackConfig = { mappings: mappingConfig.mappings, fallback_role_uuid: allowedRole.portable_uuid };
const saveFallback = await request("/auth/config", "PUT", { proxy: { role_mappings: fallbackConfig } }, { "Remote-User": "proxy-owner" });
const proxyFallback = await request("/tags", "POST", { name: "proxy-fallback" }, { "Remote-User": "mapped-user" });

await setSetting("auth_method", "oidc");
await setSetting("auth_oidc_mode", "mapped");
const manualSession = `${AUTH_SESSION_COOKIE}=${await createSession(profile.id, "profile")}`;
const mappedSession = `${AUTH_SESSION_COOKIE}=${await createSession(profile.id, "profile", false, allowedRole.portable_uuid)}`;
const oidcPermissions = await (await request("/profile-permissions", "GET", undefined, { Cookie: mappedSession })).json() as any;
const oidcManual = await request("/tags", "POST", { name: "oidc-manual" }, { Cookie: manualSession });
const oidcMapped = await request("/tags", "POST", { name: "oidc-mapped" }, { Cookie: mappedSession });

await setSetting("auth_method", "none");
const invalidMapping = await request("/auth/config", "PUT", {
  oidc: { role_mappings: { mappings: [{ group: "bad", role_uuid: "missing" }], fallback_role_uuid: null } },
}, ownerHeaders);
const deleteMappedRole = await request(`/access-control/groups/${allowedRole.id}?replacement_group_id=${manualRole.id}`, "DELETE", undefined, ownerHeaders);
const cleanedConfig = await (await request("/auth/config", "GET", undefined, ownerHeaders)).json() as any;

console.log("RESULT " + JSON.stringify({
  saveConfigStatus: saveConfig.status,
  rolesExposed: config.roles.some((role: any) => role.uuid === allowedRole.portable_uuid),
  mappingsRoundTrip: config.proxy.role_mappings.mappings[0]?.group === "parents" && config.oidc.role_mappings.mappings[0]?.group === "parents",
  proxyManualStatus: proxyManual.status,
  proxyEffectiveGroupId: proxyPermissions.permissions?.group_id,
  proxyEffectivePermissions: proxyPermissions.permissions?.effective,
  expectedAllowedGroupId: allowedRole.id,
  allowedRolePermissions: db.prepare("SELECT permission,allowed FROM permission_group_permissions WHERE group_id=?").all(allowedRole.id),
  proxyMappedStatus: proxyMapped.status,
  proxyPriorityStatus: proxyPriority.status,
  saveFallbackStatus: saveFallback.status,
  proxyFallbackStatus: proxyFallback.status,
  oidcManualStatus: oidcManual.status,
  oidcEffectiveGroupId: oidcPermissions.permissions?.group_id,
  oidcEffectivePermissions: oidcPermissions.permissions?.effective,
  oidcMappedStatus: oidcMapped.status,
  invalidMappingStatus: invalidMapping.status,
  deleteMappedRoleStatus: deleteMappedRole.status,
  deletedRoleRemovedFromProxyMappings: !cleanedConfig.proxy.role_mappings.mappings.some((mapping: any) => mapping.role_uuid === allowedRole.portable_uuid) && cleanedConfig.proxy.role_mappings.fallback_role_uuid === null,
  deletedRoleRemovedFromOidcMappings: !cleanedConfig.oidc.role_mappings.mappings.some((mapping: any) => mapping.role_uuid === allowedRole.portable_uuid),
}));
db.close();
