import { database } from "./database";
import { publishAppEvent } from "./appEvents";
import { NOTIFICATION_CATEGORY_DEFAULTS, notificationEnabled, type NotificationCategory } from "./notificationPreferences";
import { deliverNotificationInBackground } from "./notificationDelivery";
import type { AutoTagMatch } from "./autotags";

const insertNotification = database.prepare(`
  INSERT OR IGNORE INTO notifications (user_id, kind, dedupe_key, payload, target)
  VALUES (?, ?, ?, ?, ?)
`);

const NOTIFICATION_BATCH_SIZE = 400;

function chunks<T>(items: T[], size = NOTIFICATION_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

/** Same preference precedence as notificationEnabled(), batched over profiles. */
async function enabledUserIds(userIds: number[], kind: string, sourceId: string): Promise<Set<number>> {
  const enabled = new Set<number>();
  for (const batch of chunks(userIds)) {
    const placeholders = batch.map(() => "?").join(",");
    const rows = await database.prepare(`
      SELECT user_id, kind, source_id, enabled FROM notification_preferences
      WHERE user_id IN (${placeholders}) AND (
        (kind='*' AND source_id='') OR (kind=? AND source_id='') OR (kind=? AND source_id=?)
      )
    `).all<{ user_id: number; kind: string; source_id: string; enabled: number }>(...batch, kind, kind, sourceId);
    const byUser = new Map<number, Map<string, boolean>>();
    for (const row of rows) {
      const values = byUser.get(row.user_id) ?? new Map<string, boolean>();
      values.set(`${row.kind}:${row.source_id}`, row.enabled === 1);
      byUser.set(row.user_id, values);
    }
    for (const userId of batch) {
      const values = byUser.get(userId);
      if (values?.get("*:") === false) continue;
      if (values?.get(`${kind}:${sourceId}`) ?? values?.get(`${kind}:`) ?? (NOTIFICATION_CATEGORY_DEFAULTS[kind as NotificationCategory] ?? true)) enabled.add(userId);
    }
  }
  return enabled;
}

export async function createNotification(userId: number, kind: string, dedupeKey: string, payload: Record<string, unknown>, target: string, sourceId = ""): Promise<boolean> {
  if (!await notificationEnabled(userId, kind, sourceId)) return false;
  const created = (await insertNotification.run(userId, kind, dedupeKey, JSON.stringify(payload), target)).changes > 0;
  if (created) {
    publishAppEvent("notifications");
    // Forwarding is best effort and must never delay or fail the bell entry,
    // so the external provider is contacted outside this call.
    deliverNotificationInBackground(userId, kind, payload, target);
  }
  return created;
}

export async function notifyFollowedPlaylistVideos(playlistId: string, videoIds: string[]): Promise<number> {
  if (videoIds.length === 0) return 0;
  const followers = await database.prepare("SELECT user_id FROM user_followed_playlists WHERE playlist_id = ?").all<{ user_id: number }>(playlistId);
  if (followers.length === 0) return 0;
  const playlist = await database.prepare("SELECT title FROM channel_playlists WHERE playlist_id = ?").get<{ title: string }>(playlistId);
  const videoQuery = database.prepare(`
    SELECT v.video_id, v.title, v.thumbnail,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
           c.thumbnail AS channel_thumbnail
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `);
  let created = 0;
  for (const videoId of videoIds) {
    const video = await videoQuery.get<{ video_id: string; title: string; thumbnail: string; channel_title: string; channel_thumbnail: string }>(videoId);
    if (!video) continue;
    const payload = {
      videoId: video.video_id,
      videoTitle: video.title,
      thumbnail: video.thumbnail,
      playlistId,
      playlistTitle: playlist?.title || "",
      channelTitle: video.channel_title,
      channelThumbnail: video.channel_thumbnail,
    };
    for (const follower of followers) {
      if (await createNotification(follower.user_id, "playlist_video", `playlist_video:${playlistId}:${video.video_id}`, payload, `/watch/${video.video_id}/playlist/${playlistId}`, playlistId)) created++;
    }
  }
  return created;
}

export async function notifyChannelVideos(channelId: string, videoIds: string[]): Promise<number> {
  if (videoIds.length === 0) return 0;
  const followers = await database.prepare("SELECT user_id FROM user_channels WHERE channel_id=? AND followed=1")
    .all<{ user_id: number }>(channelId);
  if (followers.length === 0) return 0;
  const channel = await database.prepare("SELECT COALESCE(NULLIF(custom_title, ''), title) AS title, thumbnail FROM channels WHERE channel_id=?")
    .get<{ title: string; thumbnail: string }>(channelId);
  const videos = new Map<string, { video_id: string; title: string; thumbnail: string }>();
  for (const batch of chunks(videoIds)) {
    const placeholders = batch.map(() => "?").join(",");
    const rows = await database.prepare(`SELECT video_id,title,thumbnail FROM videos WHERE channel_id=? AND video_id IN (${placeholders})`)
      .all<{ video_id: string; title: string; thumbnail: string }>(channelId, ...batch);
    for (const video of rows) videos.set(video.video_id, video);
  }
  const enabled = await enabledUserIds(followers.map((row) => row.user_id), "channel_video", channelId);
  if (enabled.size === 0) return 0;
  const kind = "channel_video";
  const rows: Array<{ userId: number; dedupeKey: string; payload: Record<string, unknown>; target: string }> = [];
  for (const videoId of videoIds) {
    const video = videos.get(videoId);
    if (!video) continue;
    const payload = {
      videoId: video.video_id,
      videoTitle: video.title,
      thumbnail: video.thumbnail,
      channelId,
      channelTitle: channel?.title || "",
      channelThumbnail: channel?.thumbnail || "",
    };
    const dedupeKey = `channel_video:${channelId}:${video.video_id}`;
    const target = `/watch/${video.video_id}`;
    for (const userId of enabled) rows.push({ userId, dedupeKey, payload, target });
  }
  const deliveryByKey = new Map(rows.map((row) => [row.dedupeKey, { payload: row.payload, target: row.target }]));
  const inserted: Array<{ user_id: number; dedupe_key: string }> = [];
  for (const batch of chunks(rows)) {
    const results = await database.prepare(`
      INSERT INTO notifications (user_id, kind, dedupe_key, payload, target)
      VALUES ${batch.map(() => "(?, ?, ?, ?, ?)").join(",")}
      ON CONFLICT DO NOTHING
      RETURNING user_id, dedupe_key
    `).all<{ user_id: number; dedupe_key: string }>(
      ...batch.flatMap((row) => [row.userId, kind, row.dedupeKey, JSON.stringify(row.payload), row.target]),
    );
    inserted.push(...results);
  }
  if (inserted.length === 0) return 0;
  publishAppEvent("notifications");
  for (const row of inserted) {
    const delivery = deliveryByKey.get(row.dedupe_key);
    if (delivery) deliverNotificationInBackground(row.user_id, kind, delivery.payload, delivery.target);
  }
  return inserted.length;
}

export async function notifyDownloadFailed(videoId: string, error: string): Promise<number> {
  const video = await database.prepare(`
    SELECT v.video_id, v.title, v.thumbnail,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
           d.created_at, d.attempts
    FROM downloads d
    JOIN videos v ON v.video_id = d.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE d.video_id = ?
  `).get<{
    video_id: string;
    title: string;
    thumbnail: string;
    channel_title: string;
    created_at: string;
    attempts: number;
  }>(videoId);
  if (!video) return 0;

  const users = await database.prepare(`
    SELECT u.id FROM download_owners owner
    JOIN users u ON u.id=owner.user_id
    WHERE owner.video_id=? AND COALESCE(u.is_child,0)=0
  `).all<{ id: number }>(videoId);
  const payload = {
    videoId: video.video_id,
    videoTitle: video.title,
    thumbnail: video.thumbnail,
    channelTitle: video.channel_title,
    error,
    attempts: video.attempts,
  };
  let created = 0;
  for (const user of users) {
    const dedupeKey = `download_failed:${video.video_id}:${video.created_at}`;
    if (await createNotification(user.id, "download_failed", dedupeKey, payload, "/downloads")) created++;
  }
  return created;
}

/**
 * Notify each auto-tag rule's owner that one of their rules matched a newly
 * discovered video. Matches arrive from `applyAutoTags`, so a rule only fires
 * once per video and re-processing an existing video never notifies again.
 */
export async function notifyTagRuleMatches(videoId: string, matches: AutoTagMatch[]): Promise<number> {
  if (matches.length === 0) return 0;
  const video = await database.prepare(`
    SELECT v.video_id, v.title, v.thumbnail, v.channel_id,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
           c.thumbnail AS channel_thumbnail
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `).get<{
    video_id: string;
    title: string;
    thumbnail: string;
    channel_id: string;
    channel_title: string;
    channel_thumbnail: string;
  }>(videoId);
  if (!video) return 0;
  let created = 0;
  for (const match of matches) {
    const payload = {
      videoId: video.video_id,
      videoTitle: video.title,
      thumbnail: video.thumbnail,
      channelId: video.channel_id,
      channelTitle: video.channel_title,
      channelThumbnail: video.channel_thumbnail,
      ruleId: match.ruleId,
      rulePattern: match.pattern,
      tagName: match.tagName,
      tagColor: match.tagColor,
    };
    if (await createNotification(match.userId, "tag_rule", `tag_rule:${match.ruleId}:${video.video_id}`, payload, `/watch/${video.video_id}`, String(match.ruleId))) created++;
  }
  return created;
}
