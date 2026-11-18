import { describe, expect, test } from "bun:test";
import { parseVideoCardActionsMode } from "../src/videoCardActions";
import { parseVideoCardActionConfig, serializeVideoCardActionConfig } from "../src/videoCardActionConfig";

describe("video card action modes", () => {
  test("accepts every supported mode", () => {
    expect(["hover", "always", "bar_always", "on_demand", "delay", "off"].map(parseVideoCardActionsMode))
      .toEqual(["hover", "always", "bar_always", "on_demand", "delay", "off"]);
  });

  test("falls back to hover for missing and unsupported values", () => {
    expect(parseVideoCardActionsMode(undefined)).toBe("hover");
    expect(parseVideoCardActionsMode("instant")).toBe("hover");
  });
});

describe("video card action configuration", () => {
  test("keeps schedule first, saved visibility, and appends newly introduced actions", () => {
    const config = parseVideoCardActionConfig({ version: 1, actions: [{ id: "playlist", hidden: true }] });
    expect(config.actions[1]).toEqual({ id: "playlist", hidden: true });
    expect(config.actions.map((action) => action.id)).toEqual(["schedule", "playlist", "sessionQueue", "download", "watched", "remove", "otherPlaybackMode"]);
    expect(config.actions.at(-1)).toEqual({ id: "otherPlaybackMode", hidden: true });
  });

  test("falls back to a complete default for invalid input", () => {
    const config = parseVideoCardActionConfig('{"version":1,"actions":[{"id":"unknown","hidden":false}]}');
    expect(config.actions).toHaveLength(7);
    expect(config.actions.filter((action) => action.hidden).map((action) => action.id)).toEqual(["playlist", "download", "otherPlaybackMode"]);
    expect(JSON.parse(serializeVideoCardActionConfig(config))).toEqual(config);
  });

  test("allows schedule to be hidden but keeps remove visible", () => {
    const config = parseVideoCardActionConfig({ version: 1, actions: [{ id: "remove", hidden: true }, { id: "schedule", hidden: true }] });
    expect(config.actions[0]).toEqual({ id: "schedule", hidden: true });
    expect(config.actions.find((action) => action.id === "remove")?.hidden).toBe(false);
  });
});
