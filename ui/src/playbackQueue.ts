import type { Video } from "./apiTypes";

export const WATCHLIST_SORTS = ["schedule", "duration-asc", "duration-desc", "title-asc", "channel-asc"] as const;
export type WatchlistSort = (typeof WATCHLIST_SORTS)[number];
const PLAYLIST_SORTS = ["playlist-order", "oldest", "newest", "title-asc", "title-desc"] as const;
const USER_PLAYLIST_SORTS = [...PLAYLIST_SORTS, "added-oldest", "added-newest"] as const;

export type PlaybackQueueContext =
  | { version: 1; kind: "feed"; tags: number[]; showAll: boolean; sort: "published" | "arrival" }
  | { version: 1; kind: "liked"; showShorts: boolean }
  | { version: 1; kind: "history" }
  | { version: 1; kind: "user-playlist"; playlistUuid: string; sort: (typeof USER_PLAYLIST_SORTS)[number] }
  | { version: 1; kind: "channel-playlist"; playlistId: string; sort: (typeof PLAYLIST_SORTS)[number] }
  | { version: 1; kind: "watchlist"; sort: WatchlistSort; dueOnly: boolean }
  | { version: 1; kind: "recommendations" }
  | { version: 1; kind: "in-progress" }
  | { version: 1; kind: "session"; ids: string[] };

export const SESSION_PLAY_QUEUE_MAX_ITEMS = 100;
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export type PlayVideo = (video: Video, queue?: PlaybackQueueContext) => void;

export function isPlaybackQueueContext(value: unknown): value is PlaybackQueueContext {
  if (!value || typeof value !== "object") return false;
  const queue = value as Partial<PlaybackQueueContext>;
  if (queue.version !== 1) return false;
  if (queue.kind === "feed") return Array.isArray(queue.tags) && queue.tags.every((tag) => Number.isSafeInteger(tag) && tag > 0)
    && typeof queue.showAll === "boolean" && (queue.sort === "published" || queue.sort === "arrival");
  if (queue.kind === "liked") return typeof queue.showShorts === "boolean";
  if (queue.kind === "session") return Array.isArray(queue.ids) && queue.ids.length <= SESSION_PLAY_QUEUE_MAX_ITEMS
    && queue.ids.every((id) => typeof id === "string" && VIDEO_ID.test(id));
  if (queue.kind === "user-playlist") return typeof queue.playlistUuid === "string" && queue.playlistUuid.length > 0
    && (queue.sort === undefined || (USER_PLAYLIST_SORTS as readonly unknown[]).includes(queue.sort));
  if (queue.kind === "channel-playlist") return typeof queue.playlistId === "string" && queue.playlistId.length > 0
    && (PLAYLIST_SORTS as readonly unknown[]).includes(queue.sort);
  if (queue.kind === "watchlist") return typeof queue.dueOnly === "boolean" && (WATCHLIST_SORTS as readonly unknown[]).includes(queue.sort);
  return queue.kind === "history" || queue.kind === "recommendations" || queue.kind === "in-progress";
}
