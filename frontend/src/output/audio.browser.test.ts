import { describe, expect, it } from "vitest";
import type { Effect } from "../effects/types";
import { validateEffect } from "../effects/types";
import type { SceneMessage } from "../shared/messages";
import { SceneRenderer } from "./sceneRenderer";

const W = 16, H = 16;
const meter: Effect = {
  id: "meter", name: "Meter", params: [],
  fragment: "void main() { color = vec4(u_level, u_bass + u_beat, u_treble + u_mid, 1.0); }",
};

function setup() {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: string[] = [];
  const r = new SceneRenderer(gl, [meter], (e) => errors.push(e.log));
  const scene: SceneMessage = {
    type: "scene", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: [[0, 0], [16, 0], [16, 16], [0, 16]], area: 256, effect: "meter", params: {} }],
  };
  r.setScene(scene);
  const pixel = () => {
    const p = new Uint8Array(4);
    gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return Array.from(p.slice(0, 3));
  };
  return { r, pixel, errors };
}

describe("sound uniforms", () => {
  it("are zero until there is sound, so effects look as they do without a mic", () => {
    const { r, pixel, errors } = setup();
    r.draw(0);
    expect(errors).toEqual([]);
    expect(pixel()).toEqual([0, 0, 0]);
  });

  it("carry the latest level, bands and beat to every shader", () => {
    const { r, pixel } = setup();
    r.setAudio({ level: 0.5, bass: 0.25, mid: 0.25, treble: 0.5, beat: 0.5 });
    r.draw(0);
    const [red, g, b] = pixel();
    expect(red).toBeGreaterThan(120);
    expect(red).toBeLessThan(135);
    expect(g).toBeGreaterThan(185); // 0.75
    expect(b).toBeGreaterThan(185);
  });

  it("are reserved: an effect can't declare a param with the same name", () => {
    const clash: Effect = { ...meter, params: [{ name: "level", label: "L", type: "number", default: 0 }] };
    expect(validateEffect(clash)).toEqual(['param "level" clashes with a built-in uniform']);
  });
});
