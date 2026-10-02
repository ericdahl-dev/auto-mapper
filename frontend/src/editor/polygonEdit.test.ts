import { describe, expect, it } from "vitest";
import { insertVertex, removeVertex, toProjector } from "./polygonEdit";

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];

describe("insertVertex", () => {
  it("adds the point on the nearest edge, between that edge's corners", () => {
    expect(insertVertex(square, [50, 3])).toEqual([[0, 0], [50, 3], [100, 0], [100, 100], [0, 100]]);
    expect(insertVertex(square, [2, 60])).toEqual([[0, 0], [100, 0], [100, 100], [0, 100], [2, 60]]);
  });
});

describe("removeVertex", () => {
  it("removes a corner but never goes below a triangle", () => {
    expect(removeVertex(square, 1)).toEqual([[0, 0], [100, 100], [0, 100]]);
    expect(removeVertex([[0, 0], [1, 0], [0, 1]], 0)).toEqual([[0, 0], [1, 0], [0, 1]]);
  });
});


describe("toProjector", () => {
  it("maps a click in the scaled-down editor view to projector pixels", () => {
    const view = { left: 10, top: 20, width: 960, height: 540 };
    expect(toProjector(view, { width: 1920, height: 1080 }, 10 + 480, 20 + 270)).toEqual([960, 540]);
    expect(toProjector(view, { width: 1920, height: 1080 }, 10, 20)).toEqual([0, 0]);
  });
});
