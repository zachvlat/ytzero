import { describe, expect, spyOn, test } from "bun:test";
import type { TakeoutBundle } from "./takeout";
import { createImportSession, deleteImportSession, getImportSession } from "./importSession";

const bundle = {} as TakeoutBundle;

describe("import session retention", () => {
  test("caps the number of live parsed bundles", () => {
    const ids = Array.from({ length: 60 }, () => createImportSession(1, bundle));
    expect(ids.slice(0, 10).every((id) => getImportSession(id, 1) === null)).toBe(true);
    expect(ids.slice(-10).every((id) => getImportSession(id, 1) === bundle)).toBe(true);
    for (const id of ids.slice(-10)) deleteImportSession(id);
  });

  test("still expires sessions after the 30 minute TTL", () => {
    const id = createImportSession(7, bundle);
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now + 31 * 60_000);
    try {
      expect(getImportSession(id, 7)).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});
