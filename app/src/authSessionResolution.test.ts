import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-session-resolution-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn(["bun", "app/tests/sessionResolutionHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "auth.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Session resolution harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Session resolution harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice(7));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("account session profile resolution", () => {
  test("an unbound account session has no active profile or owner powers", () => {
    expect(result.unboundActive).toBe(0);
    expect(result.unboundIsAdmin).toBe(false);
    expect(result.unboundCanManageAdmins).toBe(false);
    expect(result.unboundGrantStatus).toBe(403);
  });

  test("the unsigned profile cookie cannot impersonate a bound session", () => {
    expect(result.bearerActive).toBe(0);
    expect(result.boundChildActive).toBe(result.childId);
  });

  test("binding on switch pins the profile on the session row", () => {
    expect(result.switchStatus).toBe(200);
    expect(result.sessionRow).toEqual({ user_id: result.childId, scope: "account" });
    expect(result.switchedActive).toBe(result.childId);
  });

  test("the 'none' method still selects the profile from the cookie", () => {
    expect(result.noneActive).toBe(result.childId);
  });
});
