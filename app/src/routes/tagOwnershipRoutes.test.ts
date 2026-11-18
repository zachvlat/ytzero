import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-tag-ownership-test-"));
const routesPath = JSON.stringify(resolve(import.meta.dir, "..", "routes.ts"));
const dbPath = JSON.stringify(resolve(import.meta.dir, "..", "db.ts"));
let result: Record<string, any> = {};

const harness = `
const { api } = await import(${routesPath});
const { db } = await import(${dbPath});
const other = db.prepare("INSERT INTO users(name, avatar_color, sort_order, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id")
  .get("Other", "#123456", 1, crypto.randomUUID()).id;
db.prepare("INSERT INTO channels(channel_id, title, url) VALUES(?, ?, ?)")
  .run("UCtagowner", "Tag channel", "https://youtube.com/channel/UCtagowner");
for (const videoId of ["tagvideo", "tagvideo-channel"]) {
  db.prepare("INSERT INTO videos(video_id, channel_id, title) VALUES(?, ?, ?)")
    .run(videoId, "UCtagowner", "Tagged video " + videoId);
}
const addTag = db.prepare("INSERT INTO tags(name, color, user_id, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id");
const mine = addTag.get("Mine", "#123456", 1, crypto.randomUUID()).id;
const theirs = addTag.get("Theirs", "#654321", other, crypto.randomUUID()).id;
const addVideoTag = db.prepare("INSERT INTO video_tags(video_id, tag_id, source) VALUES(?, ?, ?)");
const addChannelTag = db.prepare("INSERT INTO channel_tags(channel_id, tag_id) VALUES(?, ?)");
for (const tagId of [mine, theirs]) {
  addVideoTag.run("tagvideo", tagId, "manual");
  addChannelTag.run("UCtagowner", tagId);
  addVideoTag.run("tagvideo-channel", tagId, "channel");
}
const request = (profile, path) => api.request("http://localhost" + path, {
  method: "DELETE",
  headers: { Cookie: "ytzero_profile=" + profile },
});
const foreignVideo = await request(1, "/videos/tagvideo/tags/" + theirs);
const foreignChannel = await request(1, "/channels/UCtagowner/tags/" + theirs);
const ownVideo = await request(1, "/videos/tagvideo/tags/" + mine);
const ownChannel = await request(1, "/channels/UCtagowner/tags/" + mine);
const count = (sql, ...args) => db.prepare(sql).get(...args).count;
console.log("RESULT " + JSON.stringify({
  foreignVideoStatus: foreignVideo.status,
  foreignChannelStatus: foreignChannel.status,
  foreignVideoRows: count("SELECT count(*) AS count FROM video_tags WHERE video_id=? AND tag_id=?", "tagvideo", theirs),
  foreignChannelRows: count("SELECT count(*) AS count FROM channel_tags WHERE channel_id=? AND tag_id=?", "UCtagowner", theirs),
  foreignPropagatedRows: count("SELECT count(*) AS count FROM video_tags WHERE video_id=? AND tag_id=? AND source='channel'", "tagvideo-channel", theirs),
  ownVideoStatus: ownVideo.status,
  ownChannelStatus: ownChannel.status,
  ownVideoRows: count("SELECT count(*) AS count FROM video_tags WHERE video_id=? AND tag_id=?", "tagvideo", mine),
  ownChannelRows: count("SELECT count(*) AS count FROM channel_tags WHERE channel_id=? AND tag_id=?", "UCtagowner", mine),
  ownPropagatedRows: count("SELECT count(*) AS count FROM video_tags WHERE video_id=? AND tag_id=? AND source='channel'", "tagvideo-channel", mine),
}));
db.close();
`;

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "-e", harness], {
    cwd: resolve(import.meta.dir, "../.."),
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
  if (exitCode !== 0) throw new Error(`Tag ownership harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Tag ownership harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("tag deletion ownership", () => {
  test("cannot delete another profile's video tag", () => {
    expect(result.foreignVideoStatus).toBe(404);
    expect(result.foreignVideoRows).toBe(1);
  });

  test("cannot delete another profile's channel tag or its propagated video tags", () => {
    expect(result.foreignChannelStatus).toBe(404);
    expect(result.foreignChannelRows).toBe(1);
    expect(result.foreignPropagatedRows).toBe(1);
  });

  test("still deletes tags owned by the active profile", () => {
    expect(result.ownVideoStatus).toBe(200);
    expect(result.ownChannelStatus).toBe(200);
    expect(result.ownVideoRows).toBe(0);
    expect(result.ownChannelRows).toBe(0);
    expect(result.ownPropagatedRows).toBe(0);
  });
});
