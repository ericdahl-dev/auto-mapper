import { describe, expect, it } from "vitest";
import { compileEffect, fragmentSource } from "./compile";
import { EFFECTS } from "./index";
import type { Effect } from "./types";

const gl = document.createElement("canvas").getContext("webgl2")!;

describe("effect shaders", () => {
  for (const effect of EFFECTS.filter((e) => e.fragment !== null)) {
    it(`${effect.id} compiles and links`, () => {
      const result = compileEffect(gl, effect);
      expect(result.ok, result.ok ? "" : result.log).toBe(true);
    });
  }

  it("declares each param as a uniform of the right type", () => {
    const src = fragmentSource(EFFECTS.find((e) => e.id === "fill")!);
    expect(src).toContain("uniform vec3 u_colorA;");
    expect(src).toContain("uniform float u_angle;");
  });

  it("reports a broken shader with its compile log instead of throwing", () => {
    const broken: Effect = { id: "broken", name: "Broken", params: [], fragment: "void main() { color = nope; }" };
    const result = compileEffect(gl, broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.log).toMatch(/nope/);
  });
});
