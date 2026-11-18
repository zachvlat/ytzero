import { describe, expect, test } from "bun:test";
import { parseDurationSeconds } from "./downloadRules";

describe("parseDurationSeconds", () => {
  test("rejects out-of-range and negative segments", () => {
    expect(parseDurationSeconds("5:99")).toBeNull();
    expect(parseDurationSeconds("-1:90")).toBeNull();
  });
});
