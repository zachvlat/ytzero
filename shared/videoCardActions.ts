/**
 * Canonical video-card action contract shared by the browser and the server.
 *
 * Keep this module dependency-free: both independently built applications import
 * it, and deployment packaging copies it alongside their source trees.
 */
export const VIDEO_CARD_ACTION_IDS = ["schedule", "sessionQueue", "playlist", "download", "watched", "remove", "otherPlaybackMode"] as const;
export type VideoCardActionId = (typeof VIDEO_CARD_ACTION_IDS)[number];
export type VideoCardActionConfig = { version: 1; actions: Array<{ id: VideoCardActionId; hidden: boolean }> };

export const LOCKED_VIDEO_CARD_ACTION_IDS = new Set<VideoCardActionId>(["remove"]);

export const DEFAULT_VIDEO_CARD_ACTION_CONFIG: VideoCardActionConfig = {
  version: 1,
  actions: VIDEO_CARD_ACTION_IDS.map((id) => ({ id, hidden: id === "playlist" || id === "download" || id === "otherPlaybackMode" })),
};

export function parseVideoCardActionConfig(value: unknown): VideoCardActionConfig | null {
  if (typeof value === "string") {
    try { return parseVideoCardActionConfig(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const config = value as { version?: unknown; actions?: unknown };
  if (config.version !== 1 || !Array.isArray(config.actions)) return null;
  const seen = new Set<string>();
  const actions: VideoCardActionConfig["actions"] = [];
  for (const entry of config.actions) {
    if (!entry || typeof entry !== "object") return null;
    const { id, hidden } = entry as { id?: unknown; hidden?: unknown };
    if (typeof id !== "string" || !(VIDEO_CARD_ACTION_IDS as readonly string[]).includes(id) || typeof hidden !== "boolean" || seen.has(id)) return null;
    seen.add(id);
    actions.push({ id: id as VideoCardActionId, hidden: LOCKED_VIDEO_CARD_ACTION_IDS.has(id as VideoCardActionId) ? false : hidden });
  }
  for (const action of DEFAULT_VIDEO_CARD_ACTION_CONFIG.actions) if (!seen.has(action.id)) {
    const missing = { ...action };
    if (missing.id === "sessionQueue") actions.splice(Math.max(1, actions.findIndex((entry) => entry.id === "schedule") + 1), 0, missing);
    else actions.push(missing);
  }
  return { version: 1, actions: [actions.find((action) => action.id === "schedule")!, ...actions.filter((action) => action.id !== "schedule")] };
}
