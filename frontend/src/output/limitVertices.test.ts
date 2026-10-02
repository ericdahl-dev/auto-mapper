import { expect, it } from "vitest";
import { resampleOutline } from "./sceneRenderer";

it("keeps outlines that fit as they are", () => {
  const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
  expect(resampleOutline(square, 256)).toBe(square);
});

it("resamples long outlines to evenly spaced points along their length", () => {
  // Dense on one half, sparse on the other: every-k-th thinning would keep that imbalance.
  const dense = Array.from({ length: 900 }, (_, i) => [Math.cos((i / 900) * Math.PI), Math.sin((i / 900) * Math.PI)]);
  const sparse = Array.from({ length: 30 }, (_, i) => [Math.cos(Math.PI + (i / 30) * Math.PI), Math.sin(Math.PI + (i / 30) * Math.PI)]);
  const out = resampleOutline([...dense, ...sparse].map(([x, y]) => [x * 300, y * 300]), 256);

  expect(out).toHaveLength(256);
  const steps = out.map((p, i) => Math.hypot(out[(i + 1) % 256][0] - p[0], out[(i + 1) % 256][1] - p[1]));
  const mean = steps.reduce((a, b) => a + b) / steps.length;
  expect(Math.max(...steps)).toBeLessThan(mean * 1.5);
});
