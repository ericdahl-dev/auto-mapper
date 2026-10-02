import { describe, expect, it } from "vitest";
import { applyPlan } from "./applyEffect";

describe("applyPlan", () => {
  it("applies to every other surface when nothing else is selected", () => {
    expect(applyPlan(2, new Set(), 5)).toEqual({ to: undefined, label: "Apply to all 5 surfaces" });
  });

  it("applies only to the other shift-selected surfaces", () => {
    expect(applyPlan(2, new Set([2, 4, 5]), 5)).toEqual({ to: [4, 5], label: "Apply to 2 selected" });
  });

  it("falls back to all when the selection is just this surface", () => {
    expect(applyPlan(2, new Set([2]), 3).label).toBe("Apply to all 3 surfaces");
  });
});
