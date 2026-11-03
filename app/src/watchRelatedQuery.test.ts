import { describe, expect, test } from "bun:test";
import type { SearchResult } from "./youtube";
import {
  buildWatchRelatedQueries,
  buildWatchRelatedQuery,
  cleanWatchRelatedTags,
  extractTitleKeywords,
  filterWatchRelatedResults,
  interleaveWatchRelatedResults,
  WATCH_RELATED_MAX_QUERIES,
  WATCH_RELATED_RESULT_LIMIT,
} from "./watchRelatedQuery";

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

  test("extracts topic keywords from a headline title", () => {
    expect(extractTitleKeywords("Germany Gave KDE €1.3 Million. Here's What It Bought.")).toEqual(["Germany", "KDE"]);
    expect(extractTitleKeywords("Why I switched to Arch Linux (after 10 years)")).toEqual(["switched", "Arch", "Linux"]);
    expect(extractTitleKeywords("C++ vs Rust: the best language?")).toEqual(["C++", "Rust", "language"]);
    expect(extractTitleKeywords("Linus Tech Tips reviews the Framework 16", "Linus Tech Tips")).toEqual(["reviews", "Framework"]);
  });

  test("cleans creator tags", () => {
    expect(cleanWatchRelatedTags(["KDE", "kde", " linux ", "#Plasma", "The Linux Experiment", "x".repeat(41), ""], "The Linux Experiment"))
      .toEqual(["KDE", "linux", "Plasma"]);
  });

  test("prefers tags, then title keywords, as separate queries", () => {
    expect(buildWatchRelatedQueries({
      title: "Germany Gave KDE €1.3 Million. Here's What It Bought.",
      channelTitle: "Some Channel",
      tags: ["kde", "linux", "kde plasma", "open source", "germany", "sovereign tech fund", "gnome"],
    })).toEqual(["kde linux kde plasma", "Germany KDE", "open source germany sovereign tech fund"]);
  });

  test("uses title keywords and the title when a video has no tags", () => {
    expect(buildWatchRelatedQueries({
      title: "Germany Gave KDE €1.3 Million. Here's What It Bought.",
      channelTitle: "Some Channel",
    })).toEqual(["Germany KDE", "Germany Gave KDE €1.3 Million. Here's What It Bought."]);
  });

  test("falls back to the title and channel and caps the query count", () => {
    expect(buildWatchRelatedQueries({ title: "", channelTitle: "Creator Name" })).toEqual(["Creator Name"]);
    const many = buildWatchRelatedQueries({
      title: "Kernel scheduler deep dive",
      channelTitle: "Creator",
      tags: ["a1", "b2", "c3", "d4", "e5", "f6"],
    });
    expect(many.length).toBeLessThanOrEqual(WATCH_RELATED_MAX_QUERIES);
  });

  test("interleaves results from several searches", () => {
    const merged = interleaveWatchRelatedResults([
      [result("a1", "c1"), result("a2", "c1"), result("a3", "c1")],
      [result("b1", "c2")],
    ]);
    expect(merged.map((item) => item.videoId)).toEqual(["a1", "b1", "a2", "a3"]);
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
