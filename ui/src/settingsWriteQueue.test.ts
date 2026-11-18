import { afterEach, describe, expect, test } from "bun:test";
import { api } from "./api";
import { queueSettingWrite, scheduleSettingWrite } from "./settingsWriteQueue";

const originalUpdateSettings = api.updateSettings;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  api.updateSettings = originalUpdateSettings;
});

describe("settings write queue", () => {
  test("sends only the last patch in a fast burst", async () => {
    const calls: string[] = [];
    api.updateSettings = async (patch) => {
      calls.push(String(patch.grid_size));
      return {};
    };

    scheduleSettingWrite("coalesce-test", { grid_size: "1" }, { delay: 5 });
    scheduleSettingWrite("coalesce-test", { grid_size: "2" }, { delay: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls).toEqual(["2"]);
  });

  test("a failed write does not block the next write", async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    let fail = true;
    api.updateSettings = async (patch) => {
      calls.push(String(patch.grid_size));
      if (fail) {
        fail = false;
        throw new Error("offline");
      }
      return {};
    };

    queueSettingWrite("failure-test", { grid_size: "1" }, { onError: (error) => errors.push(error) });
    queueSettingWrite("failure-test", { grid_size: "2" });
    await settle();
    await settle();

    expect(calls).toEqual(["1", "2"]);
    expect(errors.length).toBe(1);
  });
});
