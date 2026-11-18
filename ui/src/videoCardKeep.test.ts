import { describe, expect, test } from "bun:test";
import type { Video } from "./api";
import { keepsCard, STATE_ONLY_FEEDBACK, videoAfterFeedback, WATCHED_FEEDBACK } from "./videoCardKeep";

function video(overrides: Partial<Video> = {}): Video {
  return {
    video_id: "abc",
    channel_id: "UC1",
    title: "A video",
    description: "",
    thumbnail: "",
    published_at: "2026-01-01",
    found_at: "2026-01-01 00:00:00",
    published_at_approximate: 0,
    members_only: 0,
    is_private: 0,
    live_status: "none",
    status: "inbox",
    bucket: null,
    show_from: null,
    is_short: 0,
    views: null,
    likes: null,
    duration: "10:00",
    watch_position: 120,
    watch_duration: 600,
    in_history: 0,
    liked: null,
    watched: null,
    channel_title: "Channel",
    channel_thumbnail: null,
    channel_subscriber_count: null,
    tags: [],
    ...overrides,
  };
}

describe("keepsCard", () => {
  test("keeps the card only for feedback the list opted into", () => {
    expect(keepsCard(STATE_ONLY_FEEDBACK, "watched")).toBe(true);
    expect(keepsCard(WATCHED_FEEDBACK, "watched")).toBe(true);
    expect(keepsCard(STATE_ONLY_FEEDBACK, "removed")).toBe(false);
  });

  test("lets every card go when the list opted out or reports nothing", () => {
    expect(keepsCard(undefined, "watched")).toBe(false);
    expect(keepsCard(STATE_ONLY_FEEDBACK, undefined)).toBe(false);
  });

  test("never keeps a card the action removed from its list", () => {
    for (const feedback of ["removed", "scheduled", "unscheduled"] as const) {
      expect(keepsCard(STATE_ONLY_FEEDBACK, feedback)).toBe(false);
    }
  });
});

describe("videoAfterFeedback", () => {
  test("marks a watched video without touching its inbox state or position", () => {
    expect(videoAfterFeedback(video(), "watched")).toEqual(video({ watched: 1 }));
  });

  test("clears watched state and progress when the video goes back to unwatched", () => {
    const result = videoAfterFeedback(video({ watched: 1, status: "queued" }), "unwatched");
    expect(result).toEqual(video({ watched: null, watch_position: null, watch_duration: null, status: "inbox" }));
  });

  test("leaves the video untouched for feedback that only moves it between lists", () => {
    const scheduled = video();
    expect(videoAfterFeedback(scheduled, "scheduled")).toBe(scheduled);
  });
});
