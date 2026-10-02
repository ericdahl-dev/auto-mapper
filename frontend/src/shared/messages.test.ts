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
});
