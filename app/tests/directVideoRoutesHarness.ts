import { strict as assert } from "node:assert";
import { readdirSync, writeSync } from "node:fs";
import { Hono } from "hono";

const { api } = await import("../src/routes");
const { database } = await import("../src/database");
const { setSetting } = await import("../src/db");
const { createSession } = await import("../src/auth");
const { directVideoStreaming } = await import("../src/directVideoStreaming");
const { liveVideoStreaming } = await import("../src/liveVideoStreaming");

await setSetting("auth_method", "shared");
await database.prepare("INSERT INTO channels(channel_id,title) VALUES('direct-channel','Direct')").run();
await database.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES('direct-test','direct-channel','Direct')").run();
await database.prepare("INSERT INTO users(id,name,is_child) VALUES(2,'Child',1)").run();
await database.prepare("INSERT OR REPLACE INTO download_settings(user_id,key,value) VALUES(1,'enabled','0'),(1,'experimental_streaming','0')").run();
const adult = await createSession(1, "account");
const child = await createSession(2, "account");
let calls = 0;
directVideoStreaming.getDirectHlsPlaylist = async (userId, videoId, file, _signal, generation) => {
  calls++;
  assert.equal(userId, 1);
  assert.equal(videoId, "direct-test");
  if (file !== "index.m3u8" && generation !== "test-version") return { kind: "stale" };
  const base = "/api/videos/direct-test/direct-hls";
  if (file === "index.m3u8") return { kind: "playlist", playlist: `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="${base}/audio.m3u8?v=test-version"\n${base}/video.m3u8?v=test-version\n` };
  const media = file.replace("m3u8", "mp4");
  return { kind: "playlist", playlist: `#EXTM3U\n#EXT-X-MAP:URI="${base}/${media}?v=test-version",BYTERANGE="4@0"\n#EXTINF:6,\n#EXT-X-BYTERANGE:4@4\n${base}/${media}?v=test-version\n#EXT-X-ENDLIST\n` };
};
directVideoStreaming.getDirectHlsResource = async (userId, _videoId, _file, range, _signal, generation) => {
  calls++;
  assert.equal(userId, 1);
  if (generation !== "test-version") return { kind: "stale" };
  assert.ok(range === "bytes=4-7" || range === "bytes=0-3");
  return { kind: "response", response: new Response(range === "bytes=0-3" ? "0123" : "4567", { status: 206, headers: {
    "Content-Type": "video/mp4", "Content-Length": "4", "Content-Range": `${range.replace("=", " ")}/16`, "Cache-Control": "no-store",
  } }) };
};
const app = new Hono().route("/api", api);
const request = (file: string, token = adult) => app.request(`http://localhost/api/videos/direct-test/direct-hls/${file}`, {
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Range: "bytes=4-7" },
});
assert.equal((await request("index.m3u8", "")).status, 401);
assert.equal((await request("index.m3u8", child)).status, 403);
assert.equal((await request("unexpected.ts")).status, 404);
assert.equal(calls, 0);
const master = await request("index.m3u8");
assert.equal(master.status, 200);
assert.match(master.headers.get("content-type")!, /mpegurl/);
assert.match(master.headers.get("cache-control")!, /no-store/);
assert.equal((await request("audio.m3u8?v=test-version")).status, 200);
assert.equal((await request("video.m3u8?v=old")).status, 410);
const media = await request("video.mp4?v=test-version");
assert.equal(media.status, 206);
assert.equal(media.headers.get("content-range"), "bytes 4-7/16");
assert.equal(await media.text(), "4567");

// The live transport uses rolling MPEG-TS segments, not the VOD byte-range graph.
await database.prepare("UPDATE videos SET live_status='live',members_only=0,is_private=0,is_unavailable=0 WHERE video_id='direct-test'").run();
let liveCalls = 0;
liveVideoStreaming.playlist = async (uid, id, file) => {
  liveCalls++; assert.equal(uid, 1); assert.equal(id, "direct-test");
  if (file === "index.m3u8") return '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=12000000,AUDIO="audio"\nvideo.m3u8\n';
  return `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:6,\nr${file === "audio.m3u8" ? "a" : "v"}0123456789abcdef_0\n`;
};
liveVideoStreaming.resource = async (uid, id, resource, range) => {
  liveCalls++; assert.equal(uid, 1); assert.equal(id, "direct-test");
  assert.ok(["rv0123456789abcdef_0", "ra0123456789abcdef_0"].includes(resource)); assert.equal(range, "bytes=0-3");
  return new Response("live", { status: 206, headers: { "Content-Type": "video/mp2t", "Content-Range": "bytes 0-3/16" } });
};

assert.equal((await app.request("http://localhost/api/videos/direct-test/live-hls/index.m3u8", { headers: { Authorization: `Bearer ${child}` } })).status, 403);
assert.equal((await app.request("http://localhost/api/videos/direct-test/live-hls/index.m3u8")).status, 401);
for (const patch of ["live_status='upcoming'", "members_only=1", "is_private=1", "is_unavailable=1"]) {
  await database.prepare("UPDATE videos SET live_status='live',members_only=0,is_private=0,is_unavailable=0 WHERE video_id='direct-test'").run();
  await database.exec(`UPDATE videos SET ${patch} WHERE video_id='direct-test'`);
  assert.equal((await app.request("http://localhost/api/videos/direct-test/live-hls/index.m3u8", { headers: { Authorization: `Bearer ${adult}` } })).status, 409);
}
assert.equal(liveCalls, 0);
assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM downloads").get<{ n: number }>())!.n, 0);
assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM download_owners").get<{ n: number }>())!.n, 0);
assert.deepEqual(readdirSync(Bun.env.DOWNLOADS_DIR!), []);
writeSync(1, "RESULT direct routes, access restrictions, disabled downloads and empty media directory verified\n");
process.exit(0);
