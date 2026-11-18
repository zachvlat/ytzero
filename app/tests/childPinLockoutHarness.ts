const { api } = await import("../src/routes");
const { database } = await import("../src/database");
const { setSetting } = await import("../src/db");

await setSetting("auth_method", "none");
const parent = "ytzero_profile=1";
const created = await api.request("http://localhost/profiles", {
  method: "POST",
  headers: { Cookie: parent, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Kid", is_child: true }),
});
const childId = (await created.json() as any).profile.id as number;
const child = `ytzero_profile=${childId}`;

await setSetting("child_lock_enabled", "1");
await setSetting("child_lock_pin_hash", await Bun.password.hash("246802"));

const requestResponse = await api.request("http://localhost/child/time-request", {
  method: "POST",
  headers: { Cookie: child, "Content-Type": "application/json" },
  body: JSON.stringify({ video_id: "kid-video" }),
});
const requestId = (await requestResponse.json() as any).id as number;

const resolve = (pin: string) => api.request(`http://localhost/child/time-requests/${requestId}/resolve`, {
  method: "POST",
  headers: { Cookie: parent, "Content-Type": "application/json" },
  body: JSON.stringify({ action: "approve", grant: "15m", pin }),
});
const wrong = [];
for (let i = 0; i < 3; i++) {
  const response = await resolve("000000");
  wrong.push({ status: response.status, ...(await response.json() as any) });
}
const lockedStatus = await (await api.request("http://localhost/child/status", { headers: { Cookie: child } })).json() as any;
const correctWhileLocked = await resolve("246802");
const requestWhileLocked = await database.prepare("SELECT status FROM child_time_requests WHERE id = ?")
  .get<{ status: string }>(requestId);
const switchWhileLocked = await api.request("http://localhost/profiles/switch", {
  method: "POST",
  headers: { Cookie: child, "Content-Type": "application/json" },
  body: JSON.stringify({ id: 1, child_lock_pin: "246802" }),
});

const unlock = await api.request(`http://localhost/profiles/${childId}/unlock-child`, {
  method: "POST",
  headers: { Cookie: parent, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const switchAfterUnlock = await api.request("http://localhost/profiles/switch", {
  method: "POST",
  headers: { Cookie: child, "Content-Type": "application/json" },
  body: JSON.stringify({ id: 1, child_lock_pin: "246802" }),
});
const correctAfterUnlock = await resolve("246802");
const requestAfterUnlock = await database.prepare("SELECT status FROM child_time_requests WHERE id = ?")
  .get<{ status: string }>(requestId);

console.log("RESULT " + JSON.stringify({
  childId,
  wrong,
  lockedStatus: { locked: lockedStatus.locked, lock_reason: lockedStatus.lock_reason },
  correctWhileLocked: { status: correctWhileLocked.status, pin_locked: (await correctWhileLocked.json() as any).pin_locked },
  requestWhileLocked: requestWhileLocked?.status,
  switchWhileLocked: switchWhileLocked.status,
  unlockStatus: unlock.status,
  switchAfterUnlock: switchAfterUnlock.status,
  correctAfterUnlock: correctAfterUnlock.status,
  requestAfterUnlock: requestAfterUnlock?.status,
}));
