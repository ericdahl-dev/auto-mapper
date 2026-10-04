import { describe, expect, it, vi } from "vitest";
import { EFFECTS } from "../effects/index";
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

// #161: dragging one surface sent the whole show on every step, and the output rebuilt every
// surface's geometry each time; with 11 surfaces it fell behind the Editor.
const W = 220, H = 40;

function show(dx = 0): ShowMessage {
  return {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: Array.from({ length: 11 }, (_, k) => {
      const x = k * 20 + (k === 3 ? dx : 0); // surface 4 is the one being dragged
      return { id: k + 1, polygon: [[x, 0], [x + 18, 0], [x + 18, 30], [x, 30]], area: 540, effect: "fill", params: {} };
    }),
  };
}

describe("a show update while a surface is dragged (#161)", () => {
  it("rebuilds only the surface that moved", () => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const r = new ShowRenderer(gl, EFFECTS, () => {});
    r.setShow(show());
    const made = vi.spyOn(gl, "createVertexArray");
    r.setShow(show(2));
    expect(made).toHaveBeenCalledTimes(2); // its fill and outline, not 22
    r.setShow(show(2));
    expect(made).toHaveBeenCalledTimes(2); // nothing changed: nothing rebuilt
  });

  it("still draws the moved surface where it now is", () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
    const r = new ShowRenderer(gl, EFFECTS, () => {});
    r.setShow(show());
    r.setShow(show(1)); // surface 4: x 61..79 now (was 60..78)
    r.draw(0);
    const px = (x: number) => {
      const p = new Uint8Array(4);
      gl.readPixels(x, H - 1 - 15, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      return p[0] + p[1] + p[2];
    };
    expect(px(60)).toBe(0); // gap left behind
    expect(px(78)).toBeGreaterThan(0); // still covered after the move
  });
});
