import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_FEED_WATCHED_VISIBILITY_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("watched feed visibility suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/feedWatchedVisibility.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-feed-watched-visibility-"));
  process.env.DB_PATH = resolve(root, "db.sqlite");

  const { db, setUserSetting } = await import("./db");
  const { feedVisibilityWhere } = await import("./feedQuery");
  const { api } = await import("./routes");

  db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UCfeed','Feed channel','')").run();
  db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UCfeed',1)").run();
  db.prepare(`INSERT INTO videos(video_id,channel_id,title,is_short,published_at,is_unavailable) VALUES
    ('inbox-unwatched','UCfeed','Inbox unwatched',0,'2099-01-01',0),
    ('inbox-watched','UCfeed','Inbox watched',0,'2099-01-02',0),
    ('inbox-later','UCfeed','Inbox later',0,'2099-01-05',0),
    ('short-unwatched','UCfeed','Short unwatched',1,'2099-01-06',0),
    ('short-watched','UCfeed','Short watched',1,'2099-01-07',0)`).run();
  db.prepare(`INSERT INTO user_videos(user_id,video_id,status,watched) VALUES
    (1,'inbox-watched','inbox',1),
    (1,'short-watched','inbox',1)`).run();

  const keepWatched = (keep: boolean) => setUserSetting(1, "keep_watched_in_feed", keep ? "1" : "0");

  function visibleIds(): string[] {
    const { where, params } = feedVisibilityWhere({}, 1);
    return db.prepare(`SELECT v.video_id FROM videos v
      LEFT JOIN user_videos uv ON uv.video_id=v.video_id AND uv.user_id=1
      WHERE ${where.join(" AND ")} ORDER BY v.video_id`).all(...params)
      .map((row: any) => row.video_id);
  }

  const request = (path: string) => api.request(`http://localhost${path}`, {
    headers: { Cookie: "ytzero_profile=1" },
  });

  async function shortsFeedIds(): Promise<string[]> {
    const response = await request("/feed?only_shorts=1&limit=50");
    const body = await response.json() as { videos: Array<{ video_id: string }> };
    return body.videos.map((video) => video.video_id).sort();
  }

  async function adjacentId(videoId: string): Promise<string | null> {
    const response = await request(`/feed/adjacent?video_id=${videoId}&direction=oldest`);
    const body = await response.json() as { video: { video_id: string } | null };
    return body.video?.video_id ?? null;
  }

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("watched videos in the main feed", () => {
    test("hides watched videos by default", async () => {
      await keepWatched(false);
      expect(visibleIds()).toEqual(["inbox-later", "inbox-unwatched"]);
    });

    test("keeps watched inbox videos when the profile opts in", async () => {
      await keepWatched(true);
      expect(visibleIds()).toEqual(["inbox-later", "inbox-unwatched", "inbox-watched"]);
    });
  });

  describe("watched shorts in the Shorts feed", () => {
    test("drops finished shorts by default", async () => {
      await keepWatched(false);
      expect(await shortsFeedIds()).toEqual(["short-unwatched"]);
    });

    test("keeps finished shorts under the same profile setting as the main feed", async () => {
      await keepWatched(true);
      expect(await shortsFeedIds()).toEqual(["short-unwatched", "short-watched"]);
    });
  });

  describe("autoplay order", () => {
    test("plays the next unwatched video even while the feed shows watched ones", async () => {
      await keepWatched(true);
      expect(visibleIds()).toContain("inbox-watched");
      expect(await adjacentId("inbox-unwatched")).toBe("inbox-later");
    });

    test("skips watched videos with the setting off as well", async () => {
      await keepWatched(false);
      expect(await adjacentId("inbox-unwatched")).toBe("inbox-later");
    });
  });
}
