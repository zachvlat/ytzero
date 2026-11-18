const { db, setUserSetting } = await import("../src/db");
const { applyGrant, isPinLocked, registerChildLockFailure } = await import("../src/childTime");

const child = db.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid,is_child) VALUES(?,?,?,?,1) RETURNING id")
  .get("Kid", "#3366ff", 1, crypto.randomUUID()) as { id: number };
await setUserSetting(child.id, "child_limit_minutes", "10");

db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-child-time','Child time channel','')").run();
db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail,duration) VALUES('child-time-video','UC-child-time','Ten minute video','','10:00')").run();
db.prepare("INSERT INTO user_videos(user_id,video_id,watch_position,watch_duration) VALUES(?,?,?,?)")
  .run(child.id, "child-time-video", 480, 600);

const failures = [
  await registerChildLockFailure(child.id),
  await registerChildLockFailure(child.id),
  await registerChildLockFailure(child.id),
];
const pinLocked = isPinLocked(child.id);
const lockUntil = (db.prepare("SELECT value FROM user_settings WHERE user_id=? AND key='child_pin_lock_until'").get(child.id) as { value: string } | null)?.value ?? null;

await applyGrant(child.id, "video_end", "child-time-video");
const extraSeconds = (db.prepare("SELECT extra_seconds FROM child_time_extras WHERE user_id=?").get(child.id) as { extra_seconds: number } | null)?.extra_seconds ?? null;

console.log("RESULT " + JSON.stringify({ failures, pinLocked, lockUntil, extraSeconds }));
db.close();
