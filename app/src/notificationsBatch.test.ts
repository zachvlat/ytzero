import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_NOTIFICATIONS_BATCH_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("notifications batching suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/notificationsBatch.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-notifications-batch-"));
  process.env.DB_PATH = resolve(root, "db", "source.db");
  const { notifyChannelVideos } = await import("./notifications");
  const { db } = await import("./db");

  db.prepare("INSERT INTO users(id,name,sort_order) VALUES(2,'Two',2)").run();
  db.prepare("INSERT INTO channels(channel_id,title,thumbnail,url) VALUES('UCbatch','Batch channel','thumb','https://youtube.com/channel/UCbatch')").run();
  for (const videoId of ["batchvideo01", "batchvideo02"]) {
    db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES(?,?,?,?)").run(videoId, "UCbatch", `Title ${videoId}`, `${videoId}.jpg`);
  }
  for (const id of [1, 2]) db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(?,'UCbatch',1)").run(id);
  db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(1,'channel_video','UCbatch',1)").run();
  db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(2,'channel_video','UCbatch',0)").run();

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("batched channel notifications", () => {
    test("inserts once per enabled follower and keeps payload and dedupe keys", async () => {
      const created = await notifyChannelVideos("UCbatch", ["batchvideo01", "batchvideo02", "missingvideo1"]);
      expect(created).toBe(2);
      const rows = db.prepare("SELECT user_id,kind,dedupe_key,payload,target FROM notifications ORDER BY user_id, dedupe_key").all() as Array<Record<string, string | number>>;
      expect(rows.map((row) => [row.user_id, row.dedupe_key])).toEqual([
        [1, "channel_video:UCbatch:batchvideo01"],
        [1, "channel_video:UCbatch:batchvideo02"],
      ]);
      expect(rows.every((row) => row.kind === "channel_video" && String(row.target).startsWith("/watch/"))).toBe(true);
      expect(JSON.parse(String(rows[0].payload))).toMatchObject({
        videoId: "batchvideo01",
        videoTitle: "Title batchvideo01",
        channelId: "UCbatch",
        channelTitle: "Batch channel",
        channelThumbnail: "thumb",
      });
      expect(await notifyChannelVideos("UCbatch", ["batchvideo01", "batchvideo02"])).toBe(0);
    });
  });
}
