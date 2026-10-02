import { describe, expect, it } from "vitest";
import { EFFECTS, effectById } from "./index";
import type { Effect } from "./types";
import { mediaSources, uniformsFor, validateEffect } from "./types";

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
  it("fills defaults and turns hex colors into 0..1 RGB", () => {
    expect(uniformsFor(sample, { speed: 2 })).toEqual({ u_tint: [1, 128 / 255, 0], u_speed: 2 });
  });

  it("ignores params the effect does not declare and clamps numbers to range", () => {
    expect(uniformsFor(sample, { speed: 99, bogus: 1 })).toEqual({ u_tint: [1, 128 / 255, 0], u_speed: 4 });
  });
});

const withMedia: Effect = {
  id: "withMedia",
  name: "With media",
  params: [
    { name: "src", label: "Image or video", type: "media", default: "" },
    { name: "fit", label: "Fit", type: "choice", default: "cover", options: [
      { value: "cover", label: "Cover" },
      { value: "stretch", label: "Stretch" },
    ] },
  ],
  fragment: "void main() { color = texture(u_src, v_uv); }",
};

describe("media and choice params", () => {
  it("validates a choice default against its options", () => {
    expect(validateEffect(withMedia)).toEqual([]);
    const bad: Effect = { ...withMedia, params: [{ ...withMedia.params[1], default: "tile" } as Effect["params"][number]] };
    expect(validateEffect(bad)).toEqual(['param "fit" default "tile" is not one of cover, stretch']);
  });

  it("passes a choice as its option index and leaves media to the renderer", () => {
    expect(uniformsFor(withMedia, { src: "/api/media/a.png", fit: "stretch" })).toEqual({ u_fit: 1 });
    expect(uniformsFor(withMedia, { fit: "bogus" })).toEqual({ u_fit: 0 });
  });

  it("lists the media sources an effect's params point at", () => {
    expect(mediaSources(withMedia, { src: "/api/media/a.png" })).toEqual({ src: "/api/media/a.png" });
    expect(mediaSources(withMedia, {})).toEqual({});
    expect(mediaSources(withMedia, { src: 7 })).toEqual({});
  });
});

describe("quad params (corner pin)", () => {
  const pinned: Effect = {
    id: "pinned",
    name: "Pinned",
    params: [{ name: "corners", label: "Corners", type: "quad" }],
    fragment: "void main() { color = vec4(1.0); }",
  };
  const DOOR = [[100, 120], [420, 80], [440, 500], [90, 430]];
  // GLSL mat3 is column-major: undo that to apply it as H · [x, y, 1].
  const apply = (m: number[], [x, y]: number[]) => {
    const w = m[2] * x + m[5] * y + m[8];
    return [(m[0] * x + m[3] * y + m[6]) / w, (m[1] * x + m[4] * y + m[7]) / w];
  };

  it("gives the shader a mat3 taking projector pixels to the image's 0..1 square", () => {
    const m = uniformsFor(pinned, { corners: DOOR }, []).u_corners as number[];
    expect(m).toHaveLength(9);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach((uv, i) => {
      const [u, v] = apply(m, DOOR[i]);
      expect(u).toBeCloseTo(uv[0], 6);
      expect(v).toBeCloseTo(uv[1], 6);
    });
  });

  it("uses the outline's own corners until the user pins some", () => {
    const outline = [[260, 100], [420, 80], [440, 500], [90, 430], [100, 120]];
    const [u, v] = apply(uniformsFor(pinned, {}, outline).u_corners as number[], [420, 80]);
    expect([u, v].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([1, 0]);
  });

  it("falls back to the outline's corners for a malformed or degenerate pin", () => {
    const outline = DOOR;
    const fromOutline = uniformsFor(pinned, {}, outline).u_corners;
    expect(uniformsFor(pinned, { corners: [[0, 0], [5, 0]] }, outline).u_corners).toEqual(fromOutline);
    expect(uniformsFor(pinned, { corners: [[0, 0], [5, 0], [10, 0], [0, 10]] }, outline).u_corners).toEqual(fromOutline);
  });
});

describe("built-in registry", () => {
  it("has the built-in effects, all valid, with unique ids", () => {
    expect(EFFECTS.map((e) => e.id)).toEqual(["none", "fill", "outline", "noise", "tint", "edgeglow", "posterize", "media", "text"]);
    for (const e of EFFECTS) expect(validateEffect(e), e.id).toEqual([]);
  });

  it("looks effects up by id and falls back to none", () => {
    expect(effectById("fill").name).toBe("Fill");
    expect(effectById("does-not-exist").id).toBe("none");
  });
});
