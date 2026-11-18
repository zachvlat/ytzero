import type { Context, Hono } from "hono";
import { database } from "../database";
import { getUserSetting } from "../db";
import { publishAppEvent } from "../appEvents";
import { log } from "../logger";
import { activeChildPlayback, applyGrant, CHILD_GRANTS, type ChildGrant, childLocalOnly, childStatus, clearChildLockFailures, isChildUser, isPinLocked, lastWatchedVideo, lockChildByParent, registerChildLockFailure, unlockChildProfile } from "../childTime";
import { type ChildDownloadRequestRow, createChildDownloadRequest, latestChildDownloadRequest, listChildDownloadRequests, resolveChildDownloadRequest } from "../childDownloadRequests";
import { ensureOnDemandVideo, OnDemandVideoImportError } from "../onDemandVideoImport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerChildRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    isAdmin: (context: ApiContext) => boolean;
    isChildLockEnabled: () => boolean;
    isSixDigitPin: (pin: unknown) => pin is string;
    verifyChildLockPin: (pin: string) => Promise<boolean>;
  },
): void {
  const { currentUserId, isAdmin, isChildLockEnabled, isSixDigitPin, verifyChildLockPin } = access;

  // Approvals are confirmed with the app-wide child lock PIN, so the child
  // can't approve their own request from an unattended parent screen. Wrong
  // attempts count against the child profile's lockout.
  async function confirmApproval(childId: number, pin: unknown): Promise<boolean> {
    if (!isChildLockEnabled()) return true;
    // A lockout must stop verification itself, not just set a flag for the UI.
    if (isPinLocked(childId)) return false;
    if (!isSixDigitPin(pin) || !(await verifyChildLockPin(pin))) {
      await registerChildLockFailure(childId);
      publishAppEvent("child-status");
      publishAppEvent("child-watching");
      return false;
    }
    await clearChildLockFailures(childId);
    return true;
  }

// ---------- child profiles (time limits & requests) ----------

api.get("/child/status", async (c) => c.json(await childStatus(currentUserId(c))));

api.get("/child/now-watching", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ watching: [] });
  const active = await activeChildPlayback();
  if (active.length === 0) return c.json({ watching: [] });
  const rows = (await Promise.all(active.map(async ({ userId, videoId }) => {
    const row = await database.prepare(
      `SELECT u.id AS user_id, u.name, u.avatar, u.avatar_color,
              v.video_id, v.title, v.thumbnail, v.channel_id,
              COALESCE(ch.custom_title, ch.title) AS channel_title, ch.thumbnail AS channel_thumbnail
       FROM users u JOIN videos v ON v.video_id = ?
       JOIN channels ch ON ch.channel_id = v.channel_id
       WHERE u.id = ? AND u.is_child = 1`
    ).get(videoId, userId) as any;
    if (!row) return [];
    const status = await childStatus(userId);
    return [{
      ...row,
      avatar: row.avatar ? `/api/profiles/${row.user_id}/avatar?v=${encodeURIComponent(row.avatar)}` : "",
      remaining_seconds: status.remaining_seconds,
      unlimited_today: status.unlimited_today,
    }];
  }))).flat();
  return c.json({ watching: rows });
});

api.post("/child/now-watching/:id/stop", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const childId = Number(c.req.param("id"));
  if (!Number.isInteger(childId) || !await isChildUser(childId)) return c.json({ error: "not found" }, 404);
  await lockChildByParent(childId);
  publishAppEvent("child-status");
  publishAppEvent("child-watching");
  log.info("child.playback_stopped", { user_id: childId, by_user_id: currentUserId(c) });
  return c.json({ ok: true });
});

// Child asks for more watch time; parents see it on their home feed for 1 h.
api.post("/child/time-request", async (c) => {
  const uid = currentUserId(c);
  if (!await isChildUser(uid)) return c.json({ error: "not a child profile" }, 403);
  const { video_id } = await c.req.json().catch(() => ({}));
  const existing = await database.prepare(
    "SELECT id FROM child_time_requests WHERE user_id = ? AND status = 'pending' AND created_at > datetime('now', '-1 hour')"
  ).get(uid) as { id: number } | null;
  if (existing) return c.json({ ok: true, id: existing.id });
  const videoId = typeof video_id === "string" && video_id ? video_id : await lastWatchedVideo(uid);
  const row = await database.prepare(
    "INSERT INTO child_time_requests (user_id, video_id) VALUES (?, ?) RETURNING id"
  ).get(uid, videoId) as { id: number };
  publishAppEvent("child-requests");
  log.info("child.time_requested", { user_id: uid, video_id: videoId });
  return c.json({ ok: true, id: row.id });
});

// Pending requests, for parent (non-child) profiles.
api.get("/child/time-requests", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ requests: [] });
  const rows = await database.prepare(
    `SELECT r.id, r.user_id, r.video_id, r.created_at, u.name, u.avatar, u.avatar_color
     FROM child_time_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'pending' AND r.created_at > datetime('now', '-1 hour')
     ORDER BY r.created_at DESC`
  ).all() as { id: number; user_id: number; video_id: string | null; created_at: string; name: string; avatar: string; avatar_color: string }[];
  return c.json({
    requests: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      video_id: r.video_id,
      created_at: r.created_at,
      name: r.name,
      avatar: r.avatar ? `/api/profiles/${r.user_id}/avatar?v=${encodeURIComponent(r.avatar)}` : "",
      avatar_color: r.avatar_color,
      // Approving is confirmed with the app-wide child lock PIN when set.
      requires_pin: isChildLockEnabled(),
    })),
  });
});

api.post("/child/time-requests/:id/resolve", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const reqId = Number(c.req.param("id"));
  const request = await database.prepare(
    "SELECT * FROM child_time_requests WHERE id = ? AND status = 'pending'"
  ).get(reqId) as { id: number; user_id: number; video_id: string | null } | null;
  if (!request) return c.json({ error: "not found" }, 404);
  const { action, grant, pin } = await c.req.json().catch(() => ({}));

  if (action === "dismiss") {
    await database.prepare("UPDATE child_time_requests SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(reqId);
    publishAppEvent("child-requests");
    return c.json({ ok: true });
  }
  if (action !== "approve" || !CHILD_GRANTS.includes(grant)) return c.json({ error: "invalid action" }, 400);

  if (!await confirmApproval(request.user_id, pin)) {
    return c.json({ error: "invalid PIN", pin_locked: isPinLocked(request.user_id) }, 401);
  }
  await applyGrant(request.user_id, grant as ChildGrant, request.video_id);
  await database.prepare(
    "UPDATE child_time_requests SET status = 'approved', grant_type = ?, resolved_at = datetime('now') WHERE id = ?"
  ).run(grant, reqId);
  publishAppEvent("child-status");
  publishAppEvent("child-watching");
  publishAppEvent("child-requests");
  log.info("child.time_granted", { user_id: request.user_id, grant });
  return c.json({ ok: true });
});

// ---------- child download requests ----------

function serializeDownloadRequest(row: ChildDownloadRequestRow, requiresPin: boolean) {
  return {
    id: row.id,
    user_id: row.user_id,
    video_id: row.video_id,
    status: row.status,
    auto: row.auto === 1,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    name: row.name,
    avatar: row.avatar ? `/api/profiles/${row.user_id}/avatar?v=${encodeURIComponent(row.avatar)}` : "",
    avatar_color: row.avatar_color,
    title: row.title ?? "",
    thumbnail: row.thumbnail ?? "",
    channel_title: row.channel_title ?? "",
    channel_thumbnail: row.channel_thumbnail ?? "",
    download_status: row.download_status,
    requires_pin: requiresPin,
  };
}

// A child locked to downloaded videos asks a parent for the one they opened.
api.post("/child/download-request", async (c) => {
  const uid = currentUserId(c);
  const status = await childStatus(uid);
  if (!status.is_child) return c.json({ error: "not a child profile" }, 403);
  if (!status.can_request_download) return c.json({ error: "download requests are turned off" }, 403);
  const { video_id: videoId } = await c.req.json().catch(() => ({})) as { video_id?: unknown };
  if (typeof videoId !== "string" || !videoId) return c.json({ error: "video_id is required" }, 400);
  const known = await database.prepare("SELECT 1 FROM videos WHERE video_id = ? AND is_private = 0 AND is_unavailable = 0").get(videoId);
  if (!known) {
    // A profile restricted to subscribed content never reaches outside the
    // library, so it must not be able to trigger a metadata extraction either.
    if (childLocalOnly(uid)) return c.json({ error: "not found" }, 404);
    try {
      await ensureOnDemandVideo(videoId, uid);
    } catch (error) {
      if (error instanceof OnDemandVideoImportError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  }
  return c.json(await createChildDownloadRequest(uid, videoId));
});

// The child's own request for one video, so the player can show where it stands.
api.get("/child/download-request", async (c) => {
  const uid = currentUserId(c);
  const videoId = c.req.query("video_id") ?? "";
  if (!videoId || !await isChildUser(uid)) return c.json({ request: null });
  return c.json({ request: await latestChildDownloadRequest(uid, videoId) ?? null });
});

// Waiting requests plus the recent decisions, for parent (non-child) profiles.
api.get("/child/download-requests", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ requests: [], history: [], monitor_visible: false });
  const requiresPin = isChildLockEnabled();
  const [pending, history] = await Promise.all([
    listChildDownloadRequests("pending"),
    listChildDownloadRequests("resolved", 12),
  ]);
  return c.json({
    requests: pending.map((row) => serializeDownloadRequest(row, requiresPin)),
    history: history.map((row) => serializeDownloadRequest(row, requiresPin)),
    // Pending requests live in the child-activity shortcut. Clients use this to
    // avoid showing them twice when that shortcut is on screen anyway.
    monitor_visible: getUserSetting(uid, "child_watching_monitor_enabled") !== "0",
  });
});

api.post("/child/download-requests/:id/resolve", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const requestId = Number(c.req.param("id"));
  if (!Number.isInteger(requestId)) return c.json({ error: "not found" }, 404);
  const request = await database.prepare(
    "SELECT user_id FROM child_download_requests WHERE id = ? AND status = 'pending'",
  ).get(requestId) as { user_id: number } | null;
  if (!request) return c.json({ error: "not found" }, 404);
  const { action, pin } = await c.req.json().catch(() => ({})) as { action?: unknown; pin?: unknown };
  if (action !== "approve" && action !== "deny") return c.json({ error: "invalid action" }, 400);
  if (action === "approve" && !await confirmApproval(request.user_id, pin)) {
    return c.json({ error: "invalid PIN", pin_locked: isPinLocked(request.user_id) }, 401);
  }
  const result = await resolveChildDownloadRequest(requestId, action, currentUserId(c));
  if (!result.ok) {
    if (result.error === "downloads-disabled") return c.json({ error: "downloads are disabled for every parent profile" }, 409);
    if (result.error === "video-unavailable") return c.json({ error: "this video can no longer be downloaded" }, 409);
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ ok: true });
});

// Clear a child profile's failed-PIN lockout (primary only).
api.post("/profiles/:id/unlock-child", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
  const id = Number(c.req.param("id"));
  if (!await isChildUser(id)) return c.json({ error: "not a child profile" }, 400);
  await unlockChildProfile(id);
  publishAppEvent("child-status");
  publishAppEvent("child-watching");
  log.info("child.pin_unlocked", { id });
  return c.json({ ok: true });
});

}
