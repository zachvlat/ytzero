import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-discovery-refresh-test-"));
const pluginsPath = JSON.stringify(resolve(import.meta.dir, "plugins.ts"));
const dbPath = JSON.stringify(resolve(import.meta.dir, "db.ts"));
let result: Record<string, any> = {};

const harness = `
const { discoveryRecommendations, refreshDiscoveryInBackground, refreshDiscoveryNow, setPluginEnabled } = await import(${pluginsPath});
const { db } = await import(${dbPath});
await setPluginEnabled("discovery", true);
db.prepare("INSERT INTO channels(channel_id, title, url) VALUES(?, ?, ?)")
  .run("UCbgrefresh", "Refresh channel", "https://youtube.com/channel/UCbgrefresh");
db.prepare("INSERT INTO videos(video_id, channel_id, title, thumbnail, published_at, is_short) VALUES(?, ?, ?, ?, datetime('now'), 0)")
  .run("bgrefresh-video", "UCbgrefresh", "Refresh video", "v.jpg");
db.prepare("INSERT INTO user_channels(user_id, channel_id, followed) VALUES(1, ?, 1)").run("UCbgrefresh");
refreshDiscoveryInBackground(1);
await new Promise((done) => setTimeout(done, 100));
const storedRows = db.prepare("SELECT count(*) AS count FROM discovery_recommendations WHERE user_id=1").get().count;
const stored = await discoveryRecommendations(1);
const forced = await refreshDiscoveryNow(1);
await setPluginEnabled("discovery", false);
const disabled = await discoveryRecommendations(1);
console.log("RESULT " + JSON.stringify({
  storedRows,
  storedEnabled: stored.enabled,
  storedIds: stored.recommendations.map((item) => item.video?.video_id),
  forcedIds: forced.recommendations.map((item) => item.video?.video_id),
  disabledEnabled: disabled.enabled,
  disabledIds: disabled.recommendations.map((item) => item.video?.video_id),
}));
db.close();
`;

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "-e", harness], {
    cwd: resolve(import.meta.dir, ".."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "source.db"),
      AVATAR_DIR: resolve(root, "avatars"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Discovery refresh harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Discovery refresh harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("discovery background refresh", () => {
  test("a background refresh persists local recommendations", () => {
    expect(result.storedRows).toBeGreaterThan(0);
    expect(result.storedEnabled).toBe(true);
    expect(result.storedIds).toContain("bgrefresh-video");
  });

  test("an explicit refresh returns the same stored recommendation", () => {
    expect(result.forcedIds).toContain("bgrefresh-video");
  });

  test("disabling the plugin hides stored recommendations", () => {
    expect(result.disabledEnabled).toBe(false);
    expect(result.disabledIds).toEqual([]);
  });
});
