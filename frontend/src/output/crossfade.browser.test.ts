import { describe, expect, it } from "vitest";
import { EFFECTS } from "../effects/index";
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

const W = 32, H = 32;
const SQUARE = [[0, 0], [32, 0], [32, 32], [0, 32]];

function scene(id: number, color: string, mode: "edit" | "play" = "play"): ShowMessage {
  return {
    type: "show", width: W, height: H, selected: null, presentation: { mode, blackout: false },
    scene: id, scenes: [{ id: 1, name: "A", duration: 10 }, { id: 2, name: "B", duration: 10 }],
    playlist: { crossfade: 1, loop: true },
    surfaces: [{ id: 1, polygon: SQUARE, area: 1024, effect: "fill", params: { colorA: color, colorB: color } }],
  };
}

function setup() {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const r = new ShowRenderer(gl, EFFECTS, () => {});
  const rgb = () => {
    const p = new Uint8Array(4);
    gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return [p[0], p[1], p[2]];
  };
  return { r, rgb };
}

describe("crossfading between scenes", () => {
  it("halfway through, the output is a blend of the two scenes", () => {
    const { r, rgb } = setup();
    r.setShow(scene(1, "#ff0000"));
    r.draw(5);
    r.setShow(scene(2, "#0000ff"));
    r.draw(10); // the fade starts here
    r.draw(10.5);
    const [red, , blue] = rgb();
    expect(red).toBeGreaterThan(100);
    expect(red).toBeLessThan(155);
    expect(blue).toBeGreaterThan(100);
    expect(blue).toBeLessThan(155);
    r.draw(11.2); // done
    expect(rgb()).toEqual([0, 0, 255]);
  });

  it("edits to the same scene, and opening a scene in Edit mode, switch at once", () => {
    const { r, rgb } = setup();
    r.setShow(scene(1, "#ff0000"));
    r.draw(0);
    r.setShow(scene(1, "#00ff00")); // a settings change, not a new scene
    r.draw(0.1);
    expect(rgb()).toEqual([0, 255, 0]);
    r.setShow(scene(2, "#0000ff", "edit"));
    r.draw(0.2);
    expect(rgb()).toEqual([0, 0, 255]);
  });
});
