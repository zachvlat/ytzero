import { describe, expect, test } from "bun:test";
import { DEFAULT_VIDEO_CARD_ACTION_CONFIG, isVideoCardActionMode, isVideoCardPreviewMode, normalizeVideoCardActionConfig, normalizeVideoCardActionMode, normalizeVideoCardSetting, normalizeVideoCardSwipeConfig, parseVideoCardActionConfig, parseVideoCardSwipeConfig, validateVideoCardSettings, VIDEO_CARD_ACTION_IDS, VIDEO_CARD_ACTION_MODES } from "./videoCardActions";

describe("video card action modes", () => {
  test("accepts every persisted mode", () => {
    expect(VIDEO_CARD_ACTION_MODES.every(isVideoCardActionMode)).toBe(true);
    expect(isVideoCardActionMode("bar_always")).toBe(true);
  });

  test("validates and normalizes hover preview modes", () => {
    expect(["off", "downloaded", "all"].every(isVideoCardPreviewMode)).toBe(true);
    expect(isVideoCardPreviewMode("local")).toBe(false);
    expect(normalizeVideoCardSetting("video_card_preview", "downloaded")).toBe("downloaded");
    expect(normalizeVideoCardSetting("video_card_preview", "invalid")).toBe("all");
    expect(validateVideoCardSettings({ video_card_preview: "invalid" })).toBe("invalid video card preview mode");
  });

  test("normalizes unsupported backup values to hover", () => {
    expect(normalizeVideoCardActionMode("surprise")).toBe("hover");
  });
});

describe("video card action configuration", () => {
  test("keeps schedule first and appends actions introduced after an older config", () => {
    expect(parseVideoCardActionConfig({ version: 1, actions: [{ id: "playlist", hidden: true }] })?.actions).toEqual([
      { id: "schedule", hidden: false },
      { id: "playlist", hidden: true },
      { id: "sessionQueue", hidden: false },
      { id: "download", hidden: true },
      { id: "watched", hidden: false },
      { id: "remove", hidden: false },
      { id: "otherPlaybackMode", hidden: true },
    ]);
  });

  test("rejects duplicate or unknown action identifiers", () => {
    expect(parseVideoCardActionConfig({ version: 1, actions: [{ id: "playlist", hidden: false }, { id: "playlist", hidden: true }] })).toBeNull();
    expect(parseVideoCardActionConfig({ version: 1, actions: [{ id: "surprise", hidden: false }] })).toBeNull();
  });

  test("normalizes malformed backup values to the default", () => {
    const actions = JSON.parse(normalizeVideoCardActionConfig("bad json")).actions;
    expect(actions).toHaveLength(7);
    expect(actions.filter((action: { hidden: boolean }) => action.hidden).map((action: { id: string }) => action.id)).toEqual(["playlist", "download", "otherPlaybackMode"]);
  });

  test("accepts and preserves a browser save containing sessionQueue", () => {
    const browserConfig = {
      version: 1,
      actions: VIDEO_CARD_ACTION_IDS.map((id) => ({ id, hidden: id === "watched" })).reverse(),
    } as const;
    const browserValue = JSON.stringify(browserConfig);

    expect(validateVideoCardSettings({ video_card_action_buttons: browserValue })).toBeNull();
    expect(parseVideoCardActionConfig(browserValue)?.actions.map((action) => action.id)).toEqual([
      "schedule", "otherPlaybackMode", "remove", "watched", "download", "playlist", "sessionQueue",
    ]);
    expect(JSON.parse(normalizeVideoCardActionConfig(browserValue)).actions.find((action: { id: string }) => action.id === "watched")?.hidden).toBe(true);
  });

  test("uses the shared complete default", () => {
    expect(DEFAULT_VIDEO_CARD_ACTION_CONFIG.actions.map((action) => action.id)).toEqual([...VIDEO_CARD_ACTION_IDS]);
  });

  test("keeps destructive recovery actions visible while preserving schedule visibility", () => {
    const config = parseVideoCardActionConfig({ version: 1, actions: [{ id: "remove", hidden: true }, { id: "schedule", hidden: true }] });
    expect(config?.actions.slice(0, 2)).toEqual([{ id: "schedule", hidden: true }, { id: "remove", hidden: false }]);
  });
});

describe("video card swipe devices", () => {
  test("defaults to every device and preserves canonical order", () => {
    expect(JSON.parse(normalizeVideoCardSwipeConfig(null)).devices).toEqual(["desktop", "tablet", "mobile"]);
    expect(parseVideoCardSwipeConfig({ version: 1, devices: ["mobile", "desktop"] })?.devices).toEqual(["desktop", "mobile"]);
  });

  test("accepts disabling swipe everywhere but rejects malformed device lists", () => {
    expect(parseVideoCardSwipeConfig({ version: 1, devices: [] })).toEqual({ version: 1, devices: [] });
    expect(parseVideoCardSwipeConfig({ version: 1, devices: ["phone"] })).toBeNull();
    expect(parseVideoCardSwipeConfig({ version: 1, devices: ["mobile", "mobile"] })).toBeNull();
  });
});
