import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_FILENAME_RECOVERY_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("filename recovery suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/downloadRecoveryFilename.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-filename-recovery-"));
  const downloadsDir = resolve(root, "downloads");
  process.env.DB_PATH = resolve(root, "db", "source.db");
  const { recoverDownloadsFromDisk } = await import("./downloadRecovery");
  const { db } = await import("./db");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(downloadsDir, { recursive: true });

  const first = "legacyaaa01";
  const second = "otheraaaa01";
  for (const videoId of [first, second]) {
    db.prepare("INSERT INTO channels(channel_id,title,url) VALUES(?,?,?)").run(`UC${videoId}`, "Channel", "");
    db.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES(?,?,?)").run(videoId, `UC${videoId}`, "Video");
    db.prepare("INSERT INTO downloads(video_id,status,path) VALUES(?,'deleted',NULL)").run(videoId);
  }
  writeFileSync(resolve(downloadsDir, `Channel - Video [${first}].mp4`), "a");
  writeFileSync(resolve(downloadsDir, `Channel - Video [${first}] [${second}].mp4`), "b");

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("legacy filename recovery", () => {
    test("recovers a single id match and leaves ambiguous matches alone", async () => {
      const result = await recoverDownloadsFromDisk(downloadsDir);
      expect([...result.recoveredVideoIds]).toEqual([first]);
      expect((db.prepare("SELECT status FROM downloads WHERE video_id=?").get(first) as { status: string }).status).toBe("done");
      expect((db.prepare("SELECT status FROM downloads WHERE video_id=?").get(second) as { status: string }).status).toBe("deleted");
    });
  });
}
