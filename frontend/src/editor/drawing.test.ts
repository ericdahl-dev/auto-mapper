import { describe, expect, it } from "vitest";
import { drawStep, idleDraw } from "./drawing";

describe("drawing a surface", () => {
  it("collects clicked points and finishes into a polygon", () => {
    let s = drawStep(idleDraw, { type: "start" });
    for (const p of [[10, 10], [60, 10], [60, 40]]) s = drawStep(s, { type: "point", point: p });
    const done = drawStep(s, { type: "finish" });
    expect(done.finished).toEqual([[10, 10], [60, 10], [60, 40]]);
    expect(done.active).toBe(false);
  });

  it("does not finish with fewer than three points", () => {
    let s = drawStep(idleDraw, { type: "start" });
    s = drawStep(s, { type: "point", point: [1, 1] });
    s = drawStep(s, { type: "point", point: [2, 2] });
    const done = drawStep(s, { type: "finish" });
    expect(done.finished).toBeNull();
    expect(done.active).toBe(true);
  });

  it("ignores the extra point a double-click adds on top of the last one", () => {
    let s = drawStep(idleDraw, { type: "start" });
    for (const p of [[10, 10], [60, 10], [60, 40], [60, 40]]) s = drawStep(s, { type: "point", point: p });
    expect(s.points).toHaveLength(3);
  });

  it("cancels on escape and ignores points when not drawing", () => {
    let s = drawStep(idleDraw, { type: "start" });
    s = drawStep(s, { type: "point", point: [1, 1] });
    s = drawStep(s, { type: "cancel" });
    expect(s).toEqual(idleDraw);
    expect(drawStep(idleDraw, { type: "point", point: [5, 5] })).toEqual(idleDraw);
  });
});
