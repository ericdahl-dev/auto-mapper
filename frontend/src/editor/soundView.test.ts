import { describe, expect, it } from "vitest";
import { describeSound } from "./soundView";

describe("describeSound", () => {
  it("off: says so, no meter", () => {
    expect(describeSound({ enabled: false, device: null }, null)).toEqual({ on: false, meter: 0, note: "Off" });
  });

  it("on and hearing: shows the level", () => {
    expect(describeSound({ enabled: true, device: null }, { level: 0.42, error: null })).toEqual({ on: true, meter: 42, note: "Listening" });
  });

  it("on but the output can't listen: shows the output's error", () => {
    const v = describeSound({ enabled: true, device: "x" }, { level: 0, error: "Microphone blocked." });
    expect(v).toEqual({ on: true, meter: 0, note: "Microphone blocked." });
  });

  it("on with no output window connected: says where it listens", () => {
    expect(describeSound({ enabled: true, device: null }, null).note).toBe("Open the output window: it does the listening.");
  });
});
