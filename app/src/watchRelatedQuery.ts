import type { SearchResult } from "./youtube";

export const WATCH_RELATED_RESULT_LIMIT = 8;

export interface WatchRelatedFilterContext {
  currentVideoId: string;
  currentChannelId: string;
  localVideoIds: ReadonlySet<string>;
  followedChannelIds: ReadonlySet<string>;
  limit?: number;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Seed YouTube search with the video title and its creator. Long titles are
 * shortened first so the channel name survives the query length limit.
 */
export function buildWatchRelatedQuery(title: string, channelTitle: string): string {
  const cleanTitle = compact(title);
  const cleanChannel = compact(channelTitle);
  if (!cleanTitle) return cleanChannel.slice(0, 160).trim();
  if (!cleanChannel || cleanTitle.toLowerCase().includes(cleanChannel.toLowerCase())) {
    return cleanTitle.slice(0, 160).trim();
  }
  const titlePart = cleanTitle.slice(0, 120).trim();
  const channelPart = cleanChannel.slice(0, Math.max(0, 160 - titlePart.length - 1)).trim();
  return [titlePart, channelPart].filter(Boolean).join(" ");
}

export function filterWatchRelatedResults(
  results: readonly SearchResult[],
  context: WatchRelatedFilterContext,
): SearchResult[] {
  const limit = Math.max(0, context.limit ?? WATCH_RELATED_RESULT_LIMIT);
  if (limit === 0) return [];

  const selected: SearchResult[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const videoId = result.videoId?.trim();
    const channelId = result.channelId?.trim();
    if (!videoId || !channelId || !result.title?.trim() || !result.thumbnail?.trim()) continue;
    // Empty duration is how the search parser represents live/upcoming items.
    if (!result.duration?.trim()) continue;
    if (videoId === context.currentVideoId || channelId === context.currentChannelId) continue;
    if (context.localVideoIds.has(videoId) || context.followedChannelIds.has(channelId)) continue;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    selected.push(result);
    if (selected.length >= limit) break;
  }
  return selected;
}
