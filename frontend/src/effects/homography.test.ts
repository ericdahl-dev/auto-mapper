import { describe, expect, it } from "vitest";
import { applyHomography, autoCorners, homography } from "./homography";

const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];
// A cabinet door seen at an angle: a skewed quad in projector pixels (TL, TR, BR, BL).
const DOOR = [[100, 120], [420, 80], [440, 500], [90, 430]];

describe("homography", () => {
  it("maps each corner of one quad exactly onto the matching corner of the other", () => {
    const h = homography(DOOR, UNIT)!;
    DOOR.forEach((p, i) => {
      const [u, v] = applyHomography(h, p);
      expect(u).toBeCloseTo(UNIT[i][0], 9);
      expect(v).toBeCloseTo(UNIT[i][1], 9);
    });
  });

  it("is a perspective map, not affine: the quad's diagonal crossing lands on the image center", () => {
    // Intersection of the diagonals DOOR[0]-DOOR[2] and DOOR[1]-DOOR[3].
    const [a, c] = [DOOR[0], DOOR[2]];
    const [b, d] = [DOOR[1], DOOR[3]];
    const den = (a[0] - c[0]) * (b[1] - d[1]) - (a[1] - c[1]) * (b[0] - d[0]);
    const t = ((a[0] - b[0]) * (b[1] - d[1]) - (a[1] - b[1]) * (b[0] - d[0])) / den;
    const cross = [a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1])];
    const [u, v] = applyHomography(homography(DOOR, UNIT)!, cross);
    expect(u).toBeCloseTo(0.5, 9);
    expect(v).toBeCloseTo(0.5, 9);
  });

  it("returns null for a degenerate quad (three corners in a line)", () => {
    expect(homography([[0, 0], [5, 0], [10, 0], [0, 10]], UNIT)).toBeNull();
  });
});

describe("autoCorners", () => {
  it("picks top-left, top-right, bottom-right, bottom-left from an outline with extra points", () => {
    // The door with points along its edges and a bowed bottom, starting mid-edge.
    const outline = [[260, 100], [420, 80], [430, 300], [440, 500], [270, 480], [90, 430], [95, 280], [100, 120]];
    expect(autoCorners(outline)).toEqual(DOOR);
  });
});
