import { describe, expect, it } from "vitest";
import { media } from "../effects/media";
import { fill } from "../effects/fill";
import { canFrame, panAfterDrag, zoomAfterWheel } from "./framing";

const OUTLINE = [[100, 100], [300, 100], [300, 200], [100, 200]]; // 200 x 100 bounding box

describe("on-surface framing", () => {
  it("is offered for effects with zoom and pan params", () => {
    expect(canFrame(media)).toBe(true);
    expect(canFrame(fill)).toBe(false);
  });

  it("drag pans by the pointer's movement as a fraction of the surface, so the image follows the pointer", () => {
    expect(panAfterDrag({ panX: 0, panY: 0 }, [50, -25], OUTLINE)).toEqual({ panX: 0.25, panY: -0.25 });
    expect(panAfterDrag({ panX: 0.9, panY: 0 }, [100, 0], OUTLINE)).toEqual({ panX: 1, panY: 0 }); // clamped
  });

  it("scrolling up zooms in, down zooms out, within the param's range", () => {
    expect(zoomAfterWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomAfterWheel(1, 100)).toBeLessThan(1);
    expect(zoomAfterWheel(10, -1000)).toBe(10);
    expect(zoomAfterWheel(0.1, 1000)).toBe(0.1);
  });
});
