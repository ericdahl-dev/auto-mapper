import { describe, expect, it } from "vitest";
import { curveBezierEdge, flatten, fromPolygon, insertAnchor, moveAnchor, moveControl, removeAnchor } from "./bezier";

const square = [[0, 0], [300, 0], [300, 300], [0, 300]];

describe("Bezier outlines", () => {
  it("starts from a polygon with straight edges and flattens back to it", () => {
    const b = fromPolygon(square);
    expect(b.anchors).toEqual(square);
    expect(flatten(b)).toEqual(square);
  });

  it("curving an edge adds two control points on it, so nothing moves yet", () => {
    const b = curveBezierEdge(fromPolygon(square), 0);
    expect(b.controls[0]).toEqual([[100, 0], [200, 0]]);
    expect(flatten(b).every(([, y], i) => i > 16 || y === 0)).toBe(true); // still a straight top edge
  });

  it("dragging the control points bows the edge", () => {
    let b = curveBezierEdge(fromPolygon(square), 0);
    b = moveControl(b, 0, 0, [100, -90]);
    b = moveControl(b, 0, 1, [200, -90]);
    const top = flatten(b).filter(([, y]) => y < 0);
    expect(Math.min(...top.map(([, y]) => y))).toBeCloseTo(-67.5, 0); // cubic peak = 3/4 of the pull
    expect(flatten(b)).toContainEqual([300, 0]); // the anchors stay put
  });

  it("moving an anchor carries its control points with it", () => {
    let b = curveBezierEdge(fromPolygon(square), 0);
    b = moveAnchor(b, 0, [10, 20]);
    expect(b.anchors[0]).toEqual([10, 20]);
    expect(b.controls[0][0]).toEqual([110, 20]); // control next to anchor 0 moved too
    expect(b.controls[0][1]).toEqual([200, 0]); // the far control did not
  });

  it("splitting a curved edge keeps its shape", () => {
    let b = moveControl(moveControl(curveBezierEdge(fromPolygon(square), 0), 0, 0, [100, -90]), 0, 1, [200, -90]);
    const split = insertAnchor(b, [150, -67]);
    expect(split.anchors).toHaveLength(5);
    expect(split.anchors[1][0]).toBeCloseTo(150, 0);
    expect(split.anchors[1][1]).toBeCloseTo(-67.5, 0);
    const before = flatten(b, 64);
    for (const p of flatten(split, 32)) {
      const d = Math.min(...before.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));
      expect(d).toBeLessThan(2);
    }
  });

  it("removes an anchor but keeps at least a triangle", () => {
    expect(removeAnchor(fromPolygon(square), 1).anchors).toEqual([[0, 0], [300, 300], [0, 300]]);
    const tri = fromPolygon([[0, 0], [1, 0], [0, 1]]);
    expect(removeAnchor(tri, 0)).toBe(tri);
  });
});
