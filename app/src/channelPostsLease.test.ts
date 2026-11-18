import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_CHANNEL_POSTS_LEASE_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("channel posts lease suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/channelPostsLease.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-channel-posts-lease-"));
  process.env.DB_PATH = resolve(root, "posts.db");
  const { db } = await import("./db");
  const { database } = await import("./database");
  const { acquireMaintenance, beginMutation, maintenanceActive } = await import("./maintenance");
  const { syncChannelPosts } = await import("./channelPostsStore");

  afterAll(async () => {
    db.close();
    await database.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("channel post sync maintenance lease", () => {
    test("does not fetch or write while maintenance is active", async () => {
      const originalFetch = globalThis.fetch;
      let fetched = false;
      globalThis.fetch = (async () => { fetched = true; throw new Error("unexpected fetch"); }) as unknown as typeof fetch;
      let releaseMaintenance: (() => void) | null = null;
      try {
        releaseMaintenance = await acquireMaintenance("test");
        await expect(syncChannelPosts("UClease")).rejects.toThrow("maintenance in progress");
        expect(fetched).toBe(false);
      } finally {
        releaseMaintenance?.();
        globalThis.fetch = originalFetch;
      }
    });

    test("releases the lease after a failed sync", async () => {
      db.prepare("INSERT INTO channels(channel_id,title) VALUES('UClease','Lease')").run();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
      try {
        await expect(syncChannelPosts("UClease")).rejects.toThrow("offline");
        expect(maintenanceActive()).toBe(false);
        const release = beginMutation();
        expect(release).not.toBeNull();
        release!();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
}
