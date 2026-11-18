import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-child-pin-lockout-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn(["bun", "app/tests/childPinLockoutHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "auth.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Child PIN lockout harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Child PIN lockout harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice(7));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("child PIN lockout", () => {
  test("three wrong approval PINs lock the child profile", () => {
    expect(result.wrong.map((attempt: any) => attempt.status)).toEqual([401, 401, 401]);
    expect(result.wrong[2].pin_locked).toBe(true);
    expect(result.lockedStatus).toEqual({ locked: true, lock_reason: "pin" });
  });

  test("a locked profile rejects even the correct PIN and stays pending", () => {
    expect(result.correctWhileLocked).toEqual({ status: 401, pin_locked: true });
    expect(result.requestWhileLocked).toBe("pending");
    expect(result.switchWhileLocked).toBe(401);
  });

  test("admin unlock restores PIN verification", () => {
    expect(result.unlockStatus).toBe(200);
    expect(result.switchAfterUnlock).toBe(200);
    expect(result.correctAfterUnlock).toBe(200);
    expect(result.requestAfterUnlock).toBe("approved");
  });
});
