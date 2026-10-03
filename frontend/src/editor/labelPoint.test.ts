import { describe, expect, it } from "vitest";
import { labelPoint } from "./labelPoint";

const inside = ([x, y]: number[], poly: number[][]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

describe("where a surface's number goes", () => {
  it("in the middle of a simple shape", () => {
    const [x, y] = labelPoint([[0, 0], [100, 0], [100, 50], [0, 50]]);
    expect(x).toBeCloseTo(50, 0);
    expect(y).toBeCloseTo(25, 0);
  });

  it("inside a concave shape whose center falls outside it (an L)", () => {
    const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
    expect(inside(labelPoint(L), L)).toBe(true);
  });

  it("inside a thin crescent", () => {
    const arc = [...Array(20)].map((_, i) => [100 + 80 * Math.cos((i / 19) * Math.PI), 100 + 80 * Math.sin((i / 19) * Math.PI)])
      .concat([...Array(20)].map((_, i) => [100 + 60 * Math.cos(((19 - i) / 19) * Math.PI), 100 + 60 * Math.sin(((19 - i) / 19) * Math.PI)]));
    expect(inside(labelPoint(arc), arc)).toBe(true);
  });
});
