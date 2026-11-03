import { database } from "./database";
import { fetchRegionalLive, type RegionalLiveSnapshot } from "./youtubeLiveHub";

export const REGIONAL_LIVE_LIMIT = 48;

/**
 * Popular live streams for the requesting address's region, without channels
 * the profile already follows (those are on the Live page's own list).
 * Nothing is stored: opening one uses the normal external-video import path.
 */
export async function regionalLiveForUser(uid: number): Promise<RegionalLiveSnapshot> {
  const snapshot = await fetchRegionalLive(uid);
  const channelIds = [...new Set(snapshot.videos.map((video) => video.channelId))];
  const followed = channelIds.length === 0 ? [] : await database.prepare(
    `SELECT channel_id FROM user_channels
     WHERE user_id = ? AND followed = 1 AND channel_id IN (${channelIds.map(() => "?").join(",")})`,
  ).all<{ channel_id: string }>(uid, ...channelIds);
  const followedIds = new Set(followed.map((row) => row.channel_id));
  return {
    region: snapshot.region,
    videos: snapshot.videos.filter((video) => !followedIds.has(video.channelId)).slice(0, REGIONAL_LIVE_LIMIT),
  };
}
