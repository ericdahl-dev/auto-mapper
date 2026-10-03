import { describe, expect, it } from "vitest";
import { leadCorrection, leadTarget } from "./soundLead";

// A 10 s looping video starting from 0, at normal speed, with sound 0.2 s ahead of the picture.
const LOOP = { start: 0, duration: 10, rate: 1 };

describe("where the early sound should be", () => {
  it("is the picture's time plus the lead", () => {
    expect(leadTarget(3, 0.2, LOOP)).toBeCloseTo(3.2);
  });

  it("wraps around the loop, back to the video's start", () => {
    expect(leadTarget(9.9, 0.2, LOOP)).toBeCloseTo(0.1);
    expect(leadTarget(9.9, 0.2, { ...LOOP, start: 2 })).toBeCloseTo(2.1);
  });
});

describe("keeping the early sound locked to the picture", () => {
  it("leaves it alone when it's where it should be", () => {
    expect(leadCorrection(3, 3.205, 0.2, LOOP)).toEqual({ rate: 1 });
  });

  it("nudges its speed for a small drift, so nothing jumps", () => {
    const behind = leadCorrection(3, 3.15, 0.2, LOOP); // 50 ms behind: speed up a little
    expect("rate" in behind && behind.rate).toBeGreaterThan(1);
    expect("rate" in behind && behind.rate).toBeLessThanOrEqual(1.05);
    const ahead = leadCorrection(3, 3.25, 0.2, { ...LOOP, rate: 2 }); // ahead at double speed
    expect("rate" in ahead && ahead.rate).toBeLessThan(2);
  });

  it("seeks when it's far off (a jump, a loop wrap, or just started)", () => {
    expect(leadCorrection(3, 7, 0.2, LOOP)).toEqual({ seek: expect.closeTo(3.2, 5) });
  });

  it("measures drift across the loop point the short way round", () => {
    // Picture near the end, sound already wrapped to the start: 30 ms apart, not 10 s.
    const c = leadCorrection(9.9, 0.07, 0.2, LOOP);
    expect("rate" in c).toBe(true);
  });
});
