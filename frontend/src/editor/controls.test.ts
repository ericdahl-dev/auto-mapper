import { describe, expect, it } from "vitest";
import { effectById } from "../effects/index";
import { controlsFor, parseControlValue } from "./controls";

describe("controlsFor", () => {
  it("builds one control per param, using saved values over defaults", () => {
    const controls = controlsFor(effectById("fill"), { colorA: "#ff0000", angle: 45 });
    expect(controls.map((c) => [c.name, c.kind, c.value])).toEqual([
      ["colorA", "color", "#ff0000"],
      ["colorB", "color", "#2563eb"],
      ["angle", "range", 45],
      ["brightness", "range", 1],
    ]);
    expect(controls[2]).toMatchObject({ label: "Gradient angle", min: 0, max: 360, step: 1 });
  });

  it("has no controls for an effect without params", () => {
    expect(controlsFor(effectById("none"), {})).toEqual([]);
  });
});

describe("parseControlValue", () => {
  it("keeps colours as hex and turns range input into numbers", () => {
    expect(parseControlValue("color", "#00ff00")).toBe("#00ff00");
    expect(parseControlValue("range", "12.5")).toBe(12.5);
  });
});
