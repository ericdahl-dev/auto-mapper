import { expect, it } from "vitest";
import { limitVertices } from "./sceneRenderer";

it("keeps short polygons as they are and thins long ones to the limit", () => {
  const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
  expect(limitVertices(square, 64)).toBe(square);
  const ring = Array.from({ length: 200 }, (_, i) => [Math.cos(i), Math.sin(i)]);
  const thinned = limitVertices(ring, 64);
  expect(thinned).toHaveLength(64);
  expect(thinned[0]).toBe(ring[0]);
});
