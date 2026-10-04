import { describe, expect, it } from "vitest";
import { describeFraming } from "./framingView";

const outline: [number, number][] = [[0.1, 0.1], [0.9, 0.15], [0.85, 0.9], [0.12, 0.85]];

describe("framing check (#149)", () => {
  it("says the projection is framed well, with how much of the view it fills", () => {
    const v = describeFraming({ span: 0.8, cut_off: false, outline, advice: null });
    expect(v.text).toBe("Framed well: the projection fills 80% of the camera's view.");
    expect(v.warn).toBe(false);
  });

  it("passes on the engine's advice when it could be framed better", () => {
    const advice = "The projection fills 40% of the camera's view: zoom in or move the camera closer for a finer scan.";
    const v = describeFraming({ span: 0.4, cut_off: false, outline, advice });
    expect(v.text).toBe(advice);
    expect(v.warn).toBe(true);
  });

  it("outlines the projection on the preview, in the overlay's 0..1 space", () => {
    expect(describeFraming({ span: 0.8, cut_off: false, outline, advice: null }).points)
      .toBe("0.1,0.1 0.9,0.15 0.85,0.9 0.12,0.85");
  });

  it("passes on the engine's word when the camera doesn't see the projection", () => {
    const advice = "The camera doesn't see the projection: point it at the lit area.";
    const v = describeFraming({ span: 0, cut_off: false, outline: [], advice });
    expect(v.text).toBe("The camera doesn't see the projection: point it at the lit area.");
    expect(v.warn).toBe(true);
    expect(v.points).toBe("");
  });
});
