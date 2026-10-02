import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./messages";

const status = {
  type: "status",
  hardware: { projector: { name: "AML TV", width: 1920, height: 1080 }, cameras: [{ name: "Webcam AC410", unique_id: "0x2110000f1311306", device_type: "external" }], issues: [] },
  output_connected: true,
  output_resolution: { width: 1920, height: 1080 },
  camera: { selected: "0x2110000f1311306", calibration: null },
  can_scan: true,
};

describe("parseServerMessage", () => {
  it("accepts a status message from the engine", () => {
    expect(parseServerMessage(JSON.stringify(status))).toEqual(status);
  });

  it("accepts a test frame command", () => {
    expect(parseServerMessage('{"type":"show_test_frame","kind":"grid"}')).toEqual({
      type: "show_test_frame",
      kind: "grid",
    });
  });

  it("rejects unknown types, bad test-frame kinds and invalid JSON", () => {
    expect(parseServerMessage('{"type":"launch_missiles"}')).toBeNull();
    expect(parseServerMessage('{"type":"show_test_frame","kind":"plaid"}')).toBeNull();
    expect(parseServerMessage("not json")).toBeNull();
  });

  it("accepts pattern commands and rejects malformed ones", () => {
    const gray = { type: "show_pattern", seq: 7, pattern: { kind: "gray", axis: "y", bit: 3, inverse: true } };
    expect(parseServerMessage(JSON.stringify(gray))).toEqual(gray);
    const white = { type: "show_pattern", seq: 1, pattern: { kind: "white" } };
    expect(parseServerMessage(JSON.stringify(white))).toEqual(white);
    expect(parseServerMessage('{"type":"show_pattern","seq":2,"pattern":{"kind":"gray","axis":"z","bit":1,"inverse":false}}')).toBeNull();
    expect(parseServerMessage('{"type":"show_pattern","pattern":{"kind":"white"}}')).toBeNull();
  });

  it("accepts scan lifecycle messages", () => {
    for (const msg of [
      { type: "scan_started" },
      { type: "scan_progress", done: 3, total: 46 },
      { type: "scan_result", coverage: 0.93, seconds: 14.2, bit_reliability: { x: { "0": 0.1 } }, image: "/api/scan/latest.png?t=1" },
      { type: "scan_failed", error: "Output window did not confirm the pattern in time" },
    ]) {
      expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg);
    }
  });
});
