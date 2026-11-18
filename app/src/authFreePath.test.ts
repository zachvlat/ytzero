import { describe, expect, test } from "bun:test";
import { isAuthFreePath } from "./deviceSessionAuth";

describe("auth-free paths", () => {
  test("allows login and status endpoints before a session exists", () => {
    for (const path of [
      "/auth/status",
      "/auth/password/login",
      "/auth/passkey/login/options",
      "/auth/passkey/login/verify",
      "/auth/oidc/login",
      "/auth/oidc/callback",
      "/config",
    ]) expect(isAuthFreePath(path)).toBe(true);
  });

  test("does not exempt protected /auth routes from authentication", () => {
    for (const path of ["/auth/config", "/auth/method", "/auth/passkey/12", "/auth/profile/password"]) {
      expect(isAuthFreePath(path)).toBe(false);
    }
  });
});
