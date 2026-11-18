import type { Context, Hono } from "hono";
import { childStatus } from "../childTime";
import { database } from "../database";
import { liveVideoStreaming } from "../liveVideoStreaming";

type Environment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type LiveVideo = { live_status: string; members_only: number; is_private: number; is_unavailable: number };

export function registerLiveVideoRoutes(api: Hono<Environment>, currentUserId: (c: Context<Environment>) => number) {
  api.get("/videos/:id/live-hls/:file", async (c) => {
    const userId = currentUserId(c);
    const videoId = c.req.param("id");
    const file = c.req.param("file");
    const isPlaylist = file === "index.m3u8" || file === "video.m3u8" || file === "audio.m3u8";
    if (!isPlaylist && !/^r[av][a-f0-9]{16}_\d+$/.test(file)) return c.json({ error: "not found" }, 404);
    const video = await database.prepare("SELECT live_status, members_only, is_private, is_unavailable FROM videos WHERE video_id = ?").get<LiveVideo>(videoId);
    if (!video) return c.json({ error: "not found" }, 404);
    const child = await childStatus(userId);
    if (child.locked || child.is_child) return c.json({ error: "playback restricted" }, 403);
    if (video.members_only || video.is_private || video.is_unavailable || video.live_status === "upcoming") {
      return c.json({ error: "live playback unavailable" }, 409);
    }
    if (isPlaylist) {
      const playlist = await liveVideoStreaming.playlist(userId, videoId, file, c.req.raw.signal);
      return playlist ? new Response(playlist, { headers: {
        "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store",
      } }) : c.json({ error: "live stream unavailable" }, 502);
    }
    const response = await liveVideoStreaming.resource(userId, videoId, file, c.req.header("range") ?? null, c.req.raw.signal);
    return response ?? c.json({ error: "live resource unavailable" }, 502);
  });
}
