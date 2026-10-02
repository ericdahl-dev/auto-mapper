import { describe, expect, it } from "vitest";
import examples from "./fixtures/engine-messages.json";
import { parseServerMessage } from "./messages";

// A status the engine really sent (recorded by tests/test_message_contract.py), not a hand-written copy.
const status = examples.status;

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

  it("accepts show updates and effect errors", () => {
    const show = {
      type: "show",
      width: 1920,
      height: 1080,
      surfaces: [{ id: 2, polygon: [[0, 0], [10, 0], [10, 10]], area: 50, effect: "fill", params: { colorA: "#ff0000" } }],
      selected: 2,
      presentation: { mode: "edit", blackout: false },
    };
    expect(parseServerMessage(JSON.stringify(show))).toEqual(show);
    const err = { type: "effect_error", surface: 2, effect: "fill", log: "ERROR: 0:3: 'nope' : undeclared identifier" };
    expect(parseServerMessage(JSON.stringify(err))).toEqual(err);
    expect(parseServerMessage('{"type":"show","width":1920,"height":1080}')).toBeNull();
  });

  it("accepts the scan reload notice sent when a project opens", () => {
    expect(parseServerMessage('{"type":"scan_reload"}')).toEqual({ type: "scan_reload" });
  });
});
