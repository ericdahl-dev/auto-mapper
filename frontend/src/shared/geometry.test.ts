import { describe, expect, it } from "vitest";
import { boundingBox } from "./geometry";

describe("boundingBox", () => {
  it("is x, y, width, height of an outline in projector pixels", () => {
    expect(boundingBox([[100, 100], [300, 120], [280, 200], [90, 180]])).toEqual([90, 100, 210, 100]);
  });

  it("never has zero size, so dividing by it is safe (a line or a point)", () => {
    expect(boundingBox([[5, 5], [5, 40]])).toEqual([5, 5, 1, 35]);
    expect(boundingBox([[7, 7]])).toEqual([7, 7, 1, 1]);
  });
});

import { offsetPolygon } from "./geometry";

const area = (pts: number[][]) => Math.abs(pts.reduce((s, [x, y], i) => {
  const [nx, ny] = pts[(i + 1) % pts.length];
  return s + x * ny - nx * y;
}, 0)) / 2;

describe("offsetPolygon", () => {
  const SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]];

  it("insets every side by the distance (negative) and outsets (positive)", () => {
    expect(offsetPolygon(SQUARE, -2)).toEqual([[2, 2], [98, 2], [98, 98], [2, 98]]);
    expect(offsetPolygon(SQUARE, 3)).toEqual([[-3, -3], [103, -3], [103, 103], [-3, 103]]);
  });

  it("works whichever way the outline winds", () => {
    expect(offsetPolygon([...SQUARE].reverse(), -2)).toEqual([[2, 98], [98, 98], [98, 2], [2, 2]]);
  });

  it("keeps a concave outline's shape (an L)", () => {
    const L = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]];
    const inset = offsetPolygon(L, -2);
    expect(inset).toEqual([[2, 2], [58, 2], [58, 18], [18, 18], [18, 58], [2, 58]]);
  });

  it("follows curves (many-point outlines) without folding over", () => {
    const circle = Array.from({ length: 64 }, (_, i) => [50 + 40 * Math.cos((i / 64) * 2 * Math.PI), 50 + 40 * Math.sin((i / 64) * 2 * Math.PI)]);
    const inset = offsetPolygon(circle, -5);
    const r = inset.map(([x, y]) => Math.hypot(x - 50, y - 50));
    expect(Math.min(...r)).toBeGreaterThan(34.5);
    expect(Math.max(...r)).toBeLessThan(35.5);
  });

  it("never collapses a small surface: a big inset is limited", () => {
    const small = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const inset = offsetPolygon(small, -20);
    expect(area(inset)).toBeGreaterThan(0);
    expect(area(inset)).toBeLessThan(area(small));
  });

  it("zero leaves the outline as it is", () => {
    expect(offsetPolygon(SQUARE, 0)).toEqual(SQUARE);
  });
});
