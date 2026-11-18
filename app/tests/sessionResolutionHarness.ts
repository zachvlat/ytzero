const { api } = await import("../src/routes");
const { AUTH_SESSION_COOKIE, createSession } = await import("../src/auth");
const { database } = await import("../src/database");
const { setSetting } = await import("../src/db");

await setSetting("auth_method", "shared");
const unbound = await createSession(null, "account");
const owner = await createSession(1, "account");
const bearerUnbound = await createSession(null, "account");

const created = await api.request("http://localhost/profiles", {
  method: "POST",
  headers: { Cookie: `${AUTH_SESSION_COOKIE}=${owner}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Kid", is_child: true }),
});
const childId = (await created.json() as any).profile.id as number;
const child = await createSession(childId, "account");

const get = (path: string, cookie?: string, authorization?: string) => api.request(`http://localhost${path}`, {
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
  },
});
const post = (path: string, cookie: string, body: unknown, method = "POST") => api.request(`http://localhost${path}`, {
  method,
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const unboundCookie = `${AUTH_SESSION_COOKIE}=${unbound}; ytzero_profile=1`;
const unboundActive = (await (await get("/profiles", unboundCookie)).json() as any).active_id;
const unboundStatus = await (await get("/auth/status", unboundCookie)).json() as any;
const unboundGrant = await post(`/profiles/${childId}/admin`, unboundCookie, { is_admin: true }, "PUT");
const bearerActive = (await (await get("/profiles", `ytzero_profile=1`, bearerUnbound)).json() as any).active_id;

const childCookie = `${AUTH_SESSION_COOKIE}=${child}; ytzero_profile=1`;
const boundChildActive = (await (await get("/profiles", childCookie)).json() as any).active_id;

const switchResponse = await post("/profiles/switch", unboundCookie, { id: childId });
const sessionRow = await database.prepare("SELECT user_id, scope FROM auth_sessions WHERE token = ?")
  .get<{ user_id: number | null; scope: string }>(unbound);
const switchedActive = (await (await get("/profiles", unboundCookie)).json() as any).active_id;

// 'none' has no session identity, so the cookie must still select the profile.
await setSetting("auth_method", "none");
const noneActive = (await (await get("/profiles", `ytzero_profile=${childId}`)).json() as any).active_id;

console.log("RESULT " + JSON.stringify({
  unboundActive,
  unboundIsAdmin: unboundStatus.is_admin,
  unboundCanManageAdmins: unboundStatus.can_manage_administrators,
  unboundGrantStatus: unboundGrant.status,
  bearerActive,
  boundChildActive,
  childId,
  switchStatus: switchResponse.status,
  sessionRow,
  switchedActive,
  noneActive,
}));
