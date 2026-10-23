import { database } from "./database";
import { searchYouTube, type SearchResult } from "./youtube";
import { validYouTubeVideoId } from "./youtubeComments";
import { buildWatchRelatedQuery, filterWatchRelatedResults } from "./watchRelatedQuery";

interface WatchRelatedSeed {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
}

async function loadSeed(videoId: string): Promise<WatchRelatedSeed | null> {
  return await database.prepare(`
    SELECT
      v.video_id AS videoId,
      v.title AS title,
      v.channel_id AS channelId,
      c.title AS channelTitle
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `).get(videoId) as WatchRelatedSeed | null;
}

function placeholders(values: readonly string[]): string {
  return values.map(() => "?").join(",");
}

async function loadExcludedIds(uid: number, videoIds: readonly string[], channelIds: readonly string[]) {
  const localRowsPromise = videoIds.length === 0
    ? Promise.resolve([] as { video_id: string }[])
    : database.prepare(
      `SELECT video_id FROM videos WHERE video_id IN (${placeholders(videoIds)})`,
    ).all<{ video_id: string }>(...videoIds);
  const followedRowsPromise = channelIds.length === 0
    ? Promise.resolve([] as { channel_id: string }[])
    : database.prepare(
      `SELECT channel_id FROM user_channels
       WHERE user_id = ? AND followed = 1 AND channel_id IN (${placeholders(channelIds)})`,
    ).all<{ channel_id: string }>(uid, ...channelIds);
  const [localRows, followedRows] = await Promise.all([localRowsPromise, followedRowsPromise]);
  return {
    localVideoIds: new Set(localRows.map((row) => row.video_id)),
    followedChannelIds: new Set(followedRows.map((row) => row.channel_id)),
  };
}

/**
 * Search YouTube for watch-page recommendations outside the local library and
 * the profile's subscriptions. Results are not persisted; opening one follows
 * the normal external-video import path.
 */
export async function searchWatchRelated(uid: number, videoId: string): Promise<SearchResult[]> {
  if (!validYouTubeVideoId(videoId)) return [];
  const seed = await loadSeed(videoId);
  if (!seed) return [];

  const query = buildWatchRelatedQuery(seed.title, seed.channelTitle);
  if (!query) return [];
  const search = await searchYouTube(query, uid);
  if (search.results.length === 0) return [];

  const candidateVideoIds = [...new Set(search.results.map((result) => result.videoId).filter(Boolean))];
  const candidateChannelIds = [...new Set(search.results.map((result) => result.channelId).filter(Boolean))];
  const excluded = await loadExcludedIds(uid, candidateVideoIds, candidateChannelIds);

  return filterWatchRelatedResults(search.results, {
    currentVideoId: seed.videoId,
    currentChannelId: seed.channelId,
    ...excluded,
  });
}
