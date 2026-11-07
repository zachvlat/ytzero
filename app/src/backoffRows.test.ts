import { describe, expect, test } from "bun:test";
import { rowsOutOfBackoff } from "./backoffRows";

describe("rowsOutOfBackoff", () => {
  test("pages past a head of backed-off rows instead of returning nothing", async () => {
    const all = Array.from({ length: 50 }, (_, i) => ({ video_id: `v${i}` }));
    const retry = new Map(all.slice(0, 40).map((row) => [row.video_id, { nextAt: 2_000 }]));
    const rows = await rowsOutOfBackoff(async (size, offset) => all.slice(offset, offset + size), retry, 5, 1_000);
    expect(rows.map((row) => row.video_id)).toEqual(["v40", "v41", "v42", "v43", "v44"]);
  });
});
