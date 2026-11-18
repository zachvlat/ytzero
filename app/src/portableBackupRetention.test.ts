import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_PORTABLE_BACKUP_RETENTION_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("portable backup retention suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/portableBackupRetention.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-portable-retention-"));
  process.env.DB_PATH = resolve(root, "db", "source.db");
  process.env.RESTORE_SESSION_DIR = resolve(root, "sessions");
  const backup = await import("./portableBackup");
  const { db } = await import("./db");
  const safetyDir = resolve(root, "db", "backups");
  const snapshots = [1, 2, 3, 4, 5].map((n) => `pre-restore-2026-01-0${n}T00-00-00-000Z.db`);

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("portable backup retention", () => {
    test("keeps the last three pre-restore snapshots after a successful restore", async () => {
      mkdirSync(safetyDir, { recursive: true });
      for (const name of snapshots) writeFileSync(resolve(safetyDir, name), name);
      const profile = (await backup.backupOptions()).profiles[0]!;
      const zip = await backup.createPortableBackup({ preset: "configuration", profiles: [profile.id] });
      const analyzed = await backup.analyzePortableBackup(1, zip);
      const plan = await backup.planPortableRestore(1, analyzed.sessionId, {
        mappings: { [profile.id]: { action: "merge", targetProfileId: 1 } },
        sections: ["profile.settings"],
        strategy: "merge",
      });
      const result = await backup.commitPortableRestore(1, analyzed.sessionId, plan.planRevision);
      expect(readdirSync(safetyDir).filter((name) => name.startsWith("pre-restore-")).sort())
        .toEqual([...snapshots.slice(-2), result.snapshot.split("/").pop()!].sort());
    });

    test("removes an expired session directory when it is loaded", async () => {
      const id = crypto.randomUUID();
      const dir = resolve(process.env.RESTORE_SESSION_DIR!, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "session.json"), JSON.stringify({ id, adminId: 1, createdAt: Date.now() - 31 * 60_000 }));
      expect(() => backup.deleteRestoreSession(1, id)).toThrow("restore session expired");
      expect(existsSync(dir)).toBe(false);
    });
  });
}
