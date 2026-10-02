import { describe, expect, it } from "vitest";
import { grayCodeStripe, projectorRow } from "./patterns";

// Shared with tests/test_scan_patterns.py: width 8, 3 bits.
const SHARED: Record<number, string> = { 2: "00001111", 1: "00111100", 0: "01100110" };

describe("grayCodeStripe", () => {
  it("matches the engine's shared vector", () => {
    for (const [bit, expected] of Object.entries(SHARED)) {
      expect(Array.from(grayCodeStripe(8, Number(bit), false), (v) => (v ? 1 : 0)).join("")).toBe(expected);
    }
  });

  it("uses 255 for lit stripes and inverts on request", () => {
    expect(Array.from(grayCodeStripe(8, 2, false))).toEqual([0, 0, 0, 0, 255, 255, 255, 255]);
    expect(Array.from(grayCodeStripe(8, 2, true))).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
  });
});

describe("projectorRow", () => {
  it("counts rows from the top, unlike gl_FragCoord which counts from the bottom", () => {
    expect(projectorRow(1079.5, 1080)).toBe(0);
    expect(projectorRow(0.5, 1080)).toBe(1079);
  });
});
