import { describe, expect, test } from "bun:test";
import type { SearchResult } from "./youtube";
import { buildWatchRelatedQuery, filterWatchRelatedResults, WATCH_RELATED_RESULT_LIMIT } from "./watchRelatedQuery";

function result(videoId: string, channelId: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    videoId,
    title: `Video ${videoId}`,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: "12:34",
    channelId,
    channelTitle: `Channel ${channelId}`,
    channelAvatar: null,
    viewCount: 1000,
    published: { value: 2, unit: "day" },
    ...overrides,
  };
}

describe("watch related search", () => {
  test("builds a title and creator search query", () => {
    expect(buildWatchRelatedQuery("  A  very\n specific   title ", "Creator Name"))
      .toBe("A very specific title Creator Name");
    expect(buildWatchRelatedQuery("Creator Name explains a topic", "Creator Name"))
      .toBe("Creator Name explains a topic");
    expect(buildWatchRelatedQuery("", "Creator Name")).toBe("Creator Name");
  });

  test("filters local, followed, current and duplicate suggestions", () => {
    const selected = filterWatchRelatedResults([
      result("current01", "channel-a"),
      result("local0001", "channel-b"),
      result("followed1", "channel-c"),
      result("currentch", "current-channel"),
      result("duplicate", "channel-d"),
      result("duplicate", "channel-d"),
      result("live00001", "channel-e", { duration: "" }),
      result("blank0001", "channel-f", { title: " " }),
      result("kept00001", "channel-g"),
    ], {
      currentVideoId: "current01",
      currentChannelId: "current-channel",
      localVideoIds: new Set(["local0001"]),
      followedChannelIds: new Set(["channel-c"]),
    });

    expect(selected.map((item) => item.videoId)).toEqual(["duplicate", "kept00001"]);
  });

  test("respects the result limit", () => {
    const many = Array.from({ length: WATCH_RELATED_RESULT_LIMIT + 3 }, (_, index) =>
      result(`video${String(index).padStart(3, "0")}`, `channel-${index}`));
    const selected = filterWatchRelatedResults(many, {
      currentVideoId: "current",
      currentChannelId: "current-channel",
      localVideoIds: new Set(),
      followedChannelIds: new Set(),
    });
    expect(selected).toHaveLength(WATCH_RELATED_RESULT_LIMIT);
  });
});
