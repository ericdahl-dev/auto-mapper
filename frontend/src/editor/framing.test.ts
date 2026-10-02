import { describe, expect, it } from "vitest";
import { fill } from "../effects/fill";
import { media } from "../effects/media";
import type { Effect } from "../effects/types";
import { framingOf, panAfterDrag, zoomAfterWheel } from "./framing";

const OUTLINE = [[100, 100], [300, 100], [300, 200], [100, 200]]; // 200 x 100 bounding box

// An effect that frames with its own setting names and a narrower zoom range than media's.
const poster: Effect = {
  id: "poster", name: "Poster", fragment: "void main() { color = vec4(1.0); }",
  params: [
    { name: "scale", label: "Scale", type: "number", default: 1, min: 0.5, max: 2 },
    { name: "offsetX", label: "Offset X", type: "number", default: 0, min: -0.5, max: 0.5 },
    { name: "offsetY", label: "Offset Y", type: "number", default: 0, min: -0.5, max: 0.5 },
  ],
  framing: { zoom: "scale", panX: "offsetX", panY: "offsetY" },
};

describe("on-surface framing", () => {
  it("is offered for effects that declare a framing role, whatever their settings are called", () => {
    expect(framingOf(media)).toEqual({ zoom: "zoom", panX: "panX", panY: "panY" });
    expect(framingOf(poster)).toEqual({ zoom: "scale", panX: "offsetX", panY: "offsetY" });
    expect(framingOf(fill)).toBeNull();
  });

  it("drag pans by the pointer's movement as a fraction of the surface, within the effect's own range", () => {
    expect(panAfterDrag(media, { panX: 0, panY: 0 }, [50, -25], OUTLINE)).toEqual({ panX: 0.25, panY: -0.25 });
    expect(panAfterDrag(media, { panX: 0.9, panY: 0 }, [100, 0], OUTLINE)).toEqual({ panX: 1, panY: 0 });
    expect(panAfterDrag(poster, { panX: 0.4, panY: 0 }, [100, 0], OUTLINE)).toEqual({ panX: 0.5, panY: 0 });
  });

  it("scrolling zooms within the framed effect's own range", () => {
    expect(zoomAfterWheel(media, 1, -100)).toBeGreaterThan(1);
    expect(zoomAfterWheel(media, 1, 100)).toBeLessThan(1);
    expect(zoomAfterWheel(media, 10, -1000)).toBe(10);
    expect(zoomAfterWheel(poster, 2, -1000)).toBe(2); // poster's max, not media's 10
    expect(zoomAfterWheel(poster, 0.5, 1000)).toBe(0.5);
  });
});
