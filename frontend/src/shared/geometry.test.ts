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
