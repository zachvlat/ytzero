import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-routes-manifest-test-"));
let routes: string[] = [];

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/routesManifestHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "source.db"),
      AVATAR_DIR: resolve(root, "avatars"),
      DOWNLOADS_DIR: resolve(root, "downloads"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Routes manifest harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Routes manifest harness returned no result:\n${stdout}`);
  ({ routes } = JSON.parse(line.slice("RESULT ".length)) as { routes: string[] });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("HTTP route manifest", () => {
  test("keeps every registered method and path stable while routers are extracted", () => {
    const transcriptRoute = "POST /videos/:id/transcript";
    const playbackAdjacentRoute = "POST /playback/adjacent";
    const liveAudioRoute = "GET /videos/:id/audio-live/:resource";
    const vodAudioRoute = "GET /videos/:id/audio/index.m3u8";
    const retryAudioRoute = "POST /videos/:id/audio/retry";
    const directStreamRoute = "GET /videos/:id/direct-stream";
    const directHlsRoute = "GET /videos/:id/direct-hls/:file";
    const ytdlpConfigRoute = "PUT /downloads/ytdlp/config";
    const ytdlpUpdateRoute = "POST /downloads/ytdlp/update";
    const importVideoRoute = "POST /videos/:id/import";
    const sessionPlaylistRoute = "POST /playlists/from-session-queue";
    const clearVideoBookmarksRoute = "DELETE /videos/:id/bookmark";
    const liveChatRoute = "POST /videos/:id/live-chat";
    const clusterStatusRoute = "GET /cluster/status";
    const followedPlaylistOfflinePolicyRoute = "PUT /channel-playlists/:id/offline-policy";
    const feedBuilderRoutes = [
      "GET /feed-builder", "PUT /feed-builder", "GET /feed-builder/options", "POST /feed-builder/preview",
      "POST /feed/compositions", "POST /feed/compositions/:id/pages", "DELETE /feed/compositions/:id",
    ];
    const notificationPreferenceRoutes = [
      "GET /notification-preferences",
      "PUT /notification-preferences",
      "PUT /notification-preferences/sources/:type/:id",
      "GET /notification-preferences/delivery",
      "PUT /notification-preferences/delivery",
      "POST /notification-preferences/delivery/test",
    ];
    const accessControlRoutes = [
      "GET /access-control", "PUT /access-control/groups/:id", "POST /access-control/groups",
      "PUT /access-control/group-order", "PUT /access-control/default-group", "PUT /access-control/profiles/:id",
      "DELETE /access-control/groups/:id",
    ];
    const publicShareManagementRoutes = [
      "GET /public-shares", "PUT /public-shares/policy", "POST /public-shares",
      "PATCH /public-shares/:id", "POST /public-shares/:id/rotate", "DELETE /public-shares/:id",
    ];
    const deviceAuthRoutes = [
      "POST /auth/device/code",
      "GET /auth/device/verification",
      "POST /auth/device/authorize",
      "POST /auth/device/token",
    ];
    const childDownloadRequestRoutes = [
      "POST /child/download-request",
      "GET /child/download-request",
      "GET /child/download-requests",
      "POST /child/download-requests/:id/resolve",
    ];
    const nativePlaybackRoutes = ["POST", "PUT", "DELETE"].map((method) => `${method} /videos/:id/playback-ticket`);
    for (const route of nativePlaybackRoutes) expect(routes).toContain(route);
    expect(routes).toContain("PUT /channel-playlists/:id/sort");
    expect(routes).toHaveLength(281);
    expect(routes).toContain("GET /videos/:id/live-hls/:file");
    expect(routes).toContain(transcriptRoute);
    expect(routes).toContain(playbackAdjacentRoute);
    expect(routes).toContain(liveAudioRoute);
    expect(routes).toContain(vodAudioRoute);
    expect(routes).toContain(retryAudioRoute);
    expect(routes).toContain(directStreamRoute);
    expect(routes).toContain(directHlsRoute);
    expect(routes).toContain(ytdlpConfigRoute);
    expect(routes).toContain(ytdlpUpdateRoute);
    expect(routes).toContain(importVideoRoute);
    expect(routes).toContain(sessionPlaylistRoute);
    expect(routes).toContain(clearVideoBookmarksRoute);
    expect(routes).toContain(liveChatRoute);
    expect(routes).toContain(clusterStatusRoute);
    expect(routes).toContain(followedPlaylistOfflinePolicyRoute);
    for (const route of feedBuilderRoutes) expect(routes).toContain(route);
    for (const route of notificationPreferenceRoutes) expect(routes).toContain(route);
    for (const route of accessControlRoutes) expect(routes).toContain(route);
    for (const route of publicShareManagementRoutes) expect(routes).toContain(route);
    for (const route of deviceAuthRoutes) expect(routes).toContain(route);
    for (const route of childDownloadRequestRoutes) expect(routes).toContain(route);
    expect(routes).toContain("GET /plugins/tubearchivist/config");
    expect(routes).toContain("POST /plugins/tubearchivist/sync");
    const legacyRoutes = routes.filter((route) => route !== "GET /videos/:id/live-hls/:file" && route !== "PUT /channel-playlists/:id/sort" && route !== directHlsRoute && !nativePlaybackRoutes.includes(route) && route !== transcriptRoute && route !== playbackAdjacentRoute && route !== liveAudioRoute && route !== vodAudioRoute && route !== retryAudioRoute && route !== directStreamRoute && route !== ytdlpConfigRoute && route !== ytdlpUpdateRoute && route !== importVideoRoute && route !== sessionPlaylistRoute && route !== clearVideoBookmarksRoute && route !== liveChatRoute && route !== clusterStatusRoute && route !== followedPlaylistOfflinePolicyRoute && !feedBuilderRoutes.includes(route) && !accessControlRoutes.includes(route) && !notificationPreferenceRoutes.includes(route) && !publicShareManagementRoutes.includes(route) && !deviceAuthRoutes.includes(route) && !childDownloadRequestRoutes.includes(route));
    expect(createHash("sha256").update(legacyRoutes.join("\n")).digest("hex"))
      .toBe("80c5a76e8b9e73067474352689dee5912762cbd8933feb23ceb68592f592158b");
  });

  test("does not register duplicate method/path pairs", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
});
