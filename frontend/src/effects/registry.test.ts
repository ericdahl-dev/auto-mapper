import { describe, expect, it } from "vitest";
import { EFFECTS, effectById } from "./index";
import type { Effect } from "./types";
import { uniformsFor, validateEffect } from "./types";

const sample: Effect = {
  id: "sample",
  name: "Sample",
  params: [
    { name: "tint", label: "Tint", type: "color", default: "#ff8000" },
    { name: "speed", label: "Speed", type: "number", default: 1, min: 0, max: 4, step: 0.1 },
  ],
  fragment: "void main() { color = vec4(u_tint, 1.0); }",
};

describe("validateEffect", () => {
  it("accepts a well-formed effect", () => {
    expect(validateEffect(sample)).toEqual([]);
  });

  it("rejects duplicate, invalid or reserved param names and out-of-range defaults", () => {
    const bad: Effect = {
      ...sample,
      params: [
        { name: "tint", label: "A", type: "color", default: "#000000" },
        { name: "tint", label: "B", type: "color", default: "#000000" },
        { name: "2fast", label: "C", type: "number", default: 1 },
        { name: "time", label: "D", type: "number", default: 1 },
        { name: "speed", label: "E", type: "number", default: 9, min: 0, max: 4 },
        { name: "hue", label: "F", type: "color", default: "red" },
      ],
    };
    expect(validateEffect(bad)).toEqual([
      'duplicate param "tint"',
      'param "2fast" is not a GLSL identifier',
      'param "time" clashes with a built-in uniform',
      'param "speed" default 9 is outside 0..4',
      'param "hue" default "red" is not #rrggbb',
    ]);
  });
});

describe("uniformsFor", () => {
  it("fills defaults and turns hex colours into 0..1 RGB", () => {
    expect(uniformsFor(sample, { speed: 2 })).toEqual({ u_tint: [1, 128 / 255, 0], u_speed: 2 });
  });

  it("ignores params the effect does not declare and clamps numbers to range", () => {
    expect(uniformsFor(sample, { speed: 99, bogus: 1 })).toEqual({ u_tint: [1, 128 / 255, 0], u_speed: 4 });
  });
});

describe("built-in registry", () => {
  it("has none and fill, all valid, with unique ids", () => {
    expect(EFFECTS.map((e) => e.id)).toEqual(["none", "fill"]);
    for (const e of EFFECTS) expect(validateEffect(e), e.id).toEqual([]);
  });

  it("looks effects up by id and falls back to none", () => {
    expect(effectById("fill").name).toBe("Fill");
    expect(effectById("does-not-exist").id).toBe("none");
  });
});
