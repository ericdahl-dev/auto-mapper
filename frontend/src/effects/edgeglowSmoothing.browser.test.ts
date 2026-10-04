import { describe, expect, it } from "vitest";
import { ShowRenderer } from "../output/showRenderer";
import type { ShowMessage } from "../shared/messages";
import { EFFECTS } from "./index";

// On the rig, Edge glow on a large surface lit up noise: single stray pixels in the scan (each drawn
// as a small ring) and fine speckle. Smoothing takes a median of the scan before finding edges.
const W = 96, H = 48;

/** Flat gray wall, one stray bright pixel at (24, 24), and a real edge at x = 64 (dark to light). */
function scan(): HTMLCanvasElement {
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgb(110,110,110)"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgb(200,200,200)"; ctx.fillRect(64, 0, W - 64, H);
  ctx.fillStyle = "rgb(255,255,255)"; ctx.fillRect(24, 24, 1, 1);
  return c;
}

function glow(smoothing: number) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const r = new ShowRenderer(gl, EFFECTS, () => {});
  r.setScanImage(scan());
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: [[0, 0], [W, 0], [W, H], [0, H]], area: W * H, effect: "edgeglow",
      params: { smoothing, base: 0, spread: 1, glowColor: "#ffffff" } }],
  };
  r.setShow(show);
  r.draw(0);
  return (x: number, y: number) => {
    const p = new Uint8Array(4);
    gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return p[0];
  };
}

describe("Edge glow smoothing", () => {
  it("at 0 glows around a stray pixel, as before", () => {
    const px = glow(0);
    expect(Math.max(px(23, 24), px(25, 24), px(24, 23), px(24, 25))).toBeGreaterThan(100);
  });

  it("at 1 leaves a stray pixel dark but still glows along a real edge", () => {
    const px = glow(1);
    expect(Math.max(px(23, 24), px(25, 24), px(24, 23), px(24, 25), px(24, 24))).toBeLessThan(10);
    expect(Math.max(px(63, 24), px(64, 24))).toBeGreaterThan(100);
  });

  it("is on by default for new Edge glow surfaces", () => {
    const edgeglow = EFFECTS.find((e) => e.id === "edgeglow")!;
    expect(edgeglow.params.find((p) => p.name === "smoothing")).toMatchObject({ default: 1 });
  });
});
