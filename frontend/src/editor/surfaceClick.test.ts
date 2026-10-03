import { describe, expect, it } from "vitest";
import { surfaceClick } from "./surfaceClick";

describe("clicking a surface", () => {
  it("selects a surface that isn't selected", () => {
    expect(surfaceClick({ detail: 1, selected: false })).toBe("select");
  });

  it("deselects the selected one only after a moment, so a double-click can cancel that", () => {
    expect(surfaceClick({ detail: 1, selected: true })).toBe("deselect-soon");
  });

  it("adds a corner on the second click of a double-click on the selected surface", () => {
    expect(surfaceClick({ detail: 2, selected: true })).toBe("add-corner");
  });

  it("ignores further clicks of a double- or triple-click otherwise", () => {
    expect(surfaceClick({ detail: 2, selected: false })).toBe("ignore");
    expect(surfaceClick({ detail: 3, selected: true })).toBe("ignore");
  });
});
