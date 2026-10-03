import { describe, expect, it } from "vitest";
import { FIT, panBy, type View, zoomAt } from "./viewZoom";

const BOX = { width: 800, height: 450 }; // the stage, in screen pixels

/** Where a point of the unzoomed stage appears on screen. */
const onScreen = (v: View, [x, y]: number[]) => [v.x + x * v.scale, v.y + y * v.scale];

describe("zooming the scan view", () => {
  it("keeps the point under the pointer where it is", () => {
    const v = zoomAt(FIT, [200, 100], 4, BOX);
    expect(v.scale).toBe(4);
    expect(onScreen(v, [200, 100])).toEqual([200, 100]);
  });

  it("zooms between fit (1x) and 16x", () => {
    expect(zoomAt(FIT, [0, 0], 0.5, BOX)).toEqual(FIT);
    expect(zoomAt(FIT, [0, 0], 100, BOX).scale).toBe(16);
  });

  it("never shows past the edge of the scan", () => {
    const v = zoomAt(FIT, [790, 440], 2, BOX); // near the bottom-right corner
    expect(v.x).toBeLessThanOrEqual(0);
    expect(v.x + BOX.width * v.scale).toBeGreaterThanOrEqual(BOX.width);
    expect(v.y + BOX.height * v.scale).toBeGreaterThanOrEqual(BOX.height);
  });
});

describe("moving around a zoomed view", () => {
  it("moves by the scroll amount, stopping at the edges", () => {
    const v = zoomAt(FIT, [400, 225], 2, BOX); // x -400, y -225
    expect(panBy(v, [-100, 50], BOX)).toMatchObject({ x: -500, y: -175 });
    expect(panBy(v, [1000, 1000], BOX)).toMatchObject({ x: 0, y: 0 });
    expect(panBy(v, [-5000, -5000], BOX)).toMatchObject({ x: -800, y: -450 });
  });

  it("doesn't move at fit", () => {
    expect(panBy(FIT, [-100, 50], BOX)).toEqual(FIT);
  });
});
