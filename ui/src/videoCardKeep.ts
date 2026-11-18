import type { Video } from "./api";

/** What a card action reports back to the list it lives in. */
export type CardFeedback = "watched" | "unwatched" | "scheduled" | "unscheduled" | "removed";

// Feedback kinds that only change a video's state. Lists that show every video regardless of that
// state — channels, playlists, search, history — keep the card through them: the action still marks
// the video, the card just returns carrying the new state instead of disappearing until the next
// reload brings it back anyway.
export const STATE_ONLY_FEEDBACK: readonly CardFeedback[] = ["watched", "unwatched"];

// The main feed keeps watched videos only when the profile asked it to.
export const WATCHED_FEEDBACK: readonly CardFeedback[] = ["watched", "unwatched"];

/** Whether this list keeps the card after the action instead of animating it away. */
export function keepsCard(keepAfter: readonly CardFeedback[] | undefined, feedback: CardFeedback | undefined): boolean {
  return feedback != null && keepAfter?.includes(feedback) === true;
}

/**
 * The video a kept card shows once its action lands, mirroring what the server stored. Watched
 * videos keep their position — the watched flag alone already draws the progress bar full.
 */
export function videoAfterFeedback(video: Video, feedback: CardFeedback): Video {
  switch (feedback) {
    case "watched":
      return { ...video, watched: 1 };
    case "unwatched":
      return { ...video, watched: null, watch_position: null, watch_duration: null, status: "inbox" };
    default:
      return video;
  }
}
