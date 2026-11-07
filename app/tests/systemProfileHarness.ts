import { strict as assert } from "node:assert";
const { api } = await import("../src/routes");
const { createSession } = await import("../src/auth");
const { database } = await import("../src/database");
const { setSetting } = await import("../src/db");

await setSetting("auth_method", "none");
const token = await createSession(1, "account");
const request = (path: string, method = "GET", body?: unknown, session = token) => api.request(`http://localhost${path}`, {
  method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const created = await request("/profiles", "POST", { name: "TV linked profile", pin: "135790" });
assert.equal(created.status, 200);
const profile = (await created.json() as any).profile;
assert.match(profile.uuid, /^[0-9a-f-]{36}$/);
assert.equal(profile.has_pin, true);
const renamed = await request(`/profiles/${profile.id}`, "PATCH", { name: "Renamed TV profile" });
assert.equal((await renamed.json() as any).profile.uuid, profile.uuid);
const list = await request("/profiles");
const listed = (await list.json() as any).profiles.find((item: any) => item.id === profile.id);
assert.equal(listed.uuid, profile.uuid);
assert.equal(listed.pin_hash, undefined);
assert.equal(listed.password_hash, undefined);
assert.equal((await request("/profiles/switch", "POST", { id: profile.id, uuid: profile.uuid })).status, 401);
assert.equal((await request("/profiles/switch", "POST", { id: profile.id, pin: "135790" })).status, 200);
assert.equal((await (await request("/profiles")).json() as any).active_id, profile.id);

await database.prepare("UPDATE users SET is_child=1 WHERE id=?").run(profile.id);
await setSetting("child_lock_enabled", "1");
await setSetting("child_lock_pin_hash", await Bun.password.hash("246802"));
assert.equal((await request("/profiles/switch", "POST", { id: 1 })).status, 401);
assert.equal((await request("/profiles/switch", "POST", { id: 1, child_lock_pin: "246802" })).status, 200);

// Shared household login: the chosen profile lives on the session row, so editing the
// unsigned profile cookie can't take a child back to the admin profile.
await setSetting("auth_method", "shared");
const household = await createSession(null, "account");
const cookieRequest = (path: string, method = "GET", body?: unknown, profileId?: number) => api.request(`http://localhost${path}`, {
  method,
  headers: { "Content-Type": "application/json", Cookie: `ytzero_session=${household}${profileId ? `; ytzero_profile=${profileId}` : ""}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
assert.equal((await cookieRequest("/profiles/switch", "POST", { id: profile.id })).status, 200);
assert.equal((await (await cookieRequest("/profiles", "GET", undefined, 1)).json() as any).active_id, profile.id);

await setSetting("auth_method", "per_profile");
const personalToken = await createSession(profile.id, "profile");
const denied = await request("/profiles/switch", "POST", { id: 1 }, personalToken);
assert.equal((await denied.json() as any).requires_relogin, true);
assert.equal((await (await request("/profiles", "GET", undefined, personalToken)).json() as any).active_id, profile.id);
console.log("RESULT stable profile identity, PINs, child lock and personal-session isolation passed");
process.exit(0);
