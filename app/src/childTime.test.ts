import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-child-time-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/childTimeHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Child time harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Child time harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("child time locks and grants", () => {
  test("the third failed PIN locks the profile", () => {
    expect(result.failures).toEqual([false, false, true]);
    expect(result.pinLocked).toBe(true);
    expect(Date.parse(result.lockUntil)).toBeGreaterThan(Date.now());
  });

  test("a video_end grant adds the remaining runtime with a buffer", () => {
    expect(result.extraSeconds).toBeGreaterThan(175);
    expect(result.extraSeconds).toBeLessThan(185);
  });
});
