import { describe, expect, it } from "vitest";
import { cornerIndices, handleIndices, moveOnRun, nearestEdge } from "./curves";

/** A square whose top side is a 30-point arc. */
function archedSquare(): number[][] {
  const arc = Array.from({ length: 30 }, (_, i) => {
    const t = (i + 1) / 31;
    return [100 + 200 * t, 100 - 60 * Math.sin(Math.PI * t)];
  });
  return [[100, 100], ...arc, [300, 100], [300, 300], [100, 300]];
}

describe("cornerIndices", () => {
  it("finds the sharp corners and skips the points along a smooth curve", () => {
    expect(cornerIndices(archedSquare())).toEqual([0, 31, 32, 33]);
  });

  it("treats every vertex of a plain polygon as a corner", () => {
    expect(cornerIndices([[0, 0], [100, 0], [100, 100], [0, 100]])).toEqual([0, 1, 2, 3]);
  });
});

describe("handleIndices", () => {
  it("puts handles on corners plus a few along each curved run, not on every point", () => {
    const handles = handleIndices(archedSquare());
    expect(handles).toEqual(expect.arrayContaining([0, 31, 32, 33]));
    expect(handles.length).toBeLessThan(12);
    expect(handles.some((i) => i > 0 && i < 31)).toBe(true);
  });
});

describe("moveOnRun", () => {
  it("bends a curved run smoothly around the dragged point and keeps corners fixed", () => {
    const poly = archedSquare();
    const moved = moveOnRun(poly, 15, [poly[15][0], poly[15][1] - 30]);
    expect(moved[15][1]).toBeCloseTo(poly[15][1] - 30, 0);
    expect(moved[14][1]).toBeLessThan(poly[14][1]); // neighbors follow...
    expect(poly[14][1] - moved[14][1]).toBeLessThan(30); // ...less than the dragged point
    for (const c of [0, 31, 32, 33]) expect(moved[c]).toEqual(poly[c]); // corners don't move
  });

  it("moves just the corner when a corner is dragged", () => {
    const poly = archedSquare();
    const moved = moveOnRun(poly, 32, [320, 310]);
    expect(moved[32]).toEqual([320, 310]);
    expect(moved.filter((p, i) => p !== poly[i] && (p[0] !== poly[i][0] || p[1] !== poly[i][1]))).toHaveLength(1);
  });
});


describe("nearestEdge", () => {
  it("finds the edge closest to a point", () => {
    const square = [[0, 0], [200, 0], [200, 200], [0, 200]];
    expect(nearestEdge(square, [100, 5])).toBe(0);
    expect(nearestEdge(square, [195, 120])).toBe(1);
  });
});
