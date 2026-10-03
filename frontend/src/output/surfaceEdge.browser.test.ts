import { describe, expect, it } from "vitest";
import { EFFECTS } from "../effects/index";
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

const W = 64, H = 64;
const SQUARE = [[16, 16], [48, 16], [48, 48], [16, 48]];

function render(edge: number | undefined) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const r = new ShowRenderer(gl, EFFECTS, () => {});
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: SQUARE, area: 1024, effect: "fill", params: { colorA: "#ffffff", colorB: "#ffffff" }, ...(edge === undefined ? {} : { edge }) }],
  };
  r.setShow(show);
  r.draw(0);
  return (x: number, y: number) => {
    const p = new Uint8Array(4);
    gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return p[0] > 128;
  };
}

describe("surface edge", () => {
  it("is the outline itself by default", () => {
    const lit = render(undefined);
    expect(lit(17, 32)).toBe(true); // just inside
    expect(lit(14, 32)).toBe(false); // just outside
  });

  it("shrinks the lit area inside the outline, so light doesn't spill past the object", () => {
    const lit = render(-3);
    expect(lit(17, 32)).toBe(false); // 1-2 px inside the outline: now dark
    expect(lit(32, 32)).toBe(true);
  });

  it("grows the lit area past the outline to cover a gap", () => {
    const lit = render(3);
    expect(lit(14, 32)).toBe(true); // 2 px outside: now lit
    expect(lit(10, 32)).toBe(false);
  });
});

describe("clearing the show (a new project)", () => {
  it("draws nothing once cleared", () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
    const r = new ShowRenderer(gl, EFFECTS, () => {});
    r.setShow({
      type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
      surfaces: [{ id: 1, polygon: SQUARE, area: 1024, effect: "fill", params: { colorA: "#ffffff", colorB: "#ffffff" } }],
    });
    r.clear();
    r.draw(0);
    const p = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    expect(p[0]).toBe(0);
  });
});
