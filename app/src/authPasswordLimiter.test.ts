import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-password-limiter-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn(["bun", "app/tests/authPasswordLimiterHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "auth.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Password limiter harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Password limiter harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice(7));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("password login attempt limiter", () => {
  test("blocks an IP after five failures even when usernames are rotated", () => {
    expect(result.wrong).toEqual([401, 401, 401, 401, 401]);
    expect(result.blocked).toBe(429);
  });

  test("expires after 15 minutes and counts new failures again", () => {
    expect(result.afterWindow).toBe(200);
    expect(result.countsAgain).toBe(401);
  });
});
