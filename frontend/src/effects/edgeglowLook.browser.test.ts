import { describe, expect, it } from "vitest";
import { ShowRenderer } from "../output/showRenderer";
import type { ShowMessage } from "../shared/messages";
import { edgeglow } from "./edgeglow";
import { EFFECTS } from "./index";
import type { Effect } from "./types";

// #158 made Edge glow read precomputed edges; it must look as it did. The original, computing the
// Sobel edge of the scan's brightness per pixel, kept here as the reference.
const reference: Effect = {
  ...edgeglow,
  id: "edgeglowReference",
  fragment: `
void main() {
  float d = u_spread;
  float tl = luminance(scanAt(v_pos + vec2(-d, -d))), t = luminance(scanAt(v_pos + vec2(0, -d)));
  float tr = luminance(scanAt(v_pos + vec2(d, -d))), l = luminance(scanAt(v_pos + vec2(-d, 0)));
  float r = luminance(scanAt(v_pos + vec2(d, 0))), bl = luminance(scanAt(v_pos + vec2(-d, d)));
  float b = luminance(scanAt(v_pos + vec2(0, d))), br = luminance(scanAt(v_pos + vec2(d, d)));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  float edge = smoothstep(u_threshold, u_threshold * 2.0, length(vec2(gx, gy)));
  float wave = 1.0 - u_pulse * (0.5 + 0.5 * sin(u_time * 3.0 - v_pos.x * 0.01));
  color = vec4(u_glowColor * edge * wave + u_glowColor * u_base, 1.0);
}`,
};

const W = 192, H = 108;

/** A scan with real structure: soft gradients, hard edges and fine texture. */
function scanCanvas(): HTMLCanvasElement {
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const box = x > 60 && x < 130 && y > 30 && y < 80 ? 80 : 0;
    const grain = ((x * 7 + y * 13) % 17) * 2;
    const v = Math.min(255, Math.round((x / W) * 120 + box + grain));
    const i = (y * W + x) * 4;
    img.data[i] = v; img.data[i + 1] = Math.round(v * 0.8); img.data[i + 2] = Math.round(v * 0.6); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function pixels(effect: string, params: Record<string, unknown>): Uint8Array {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const r = new ShowRenderer(gl, [...EFFECTS, reference], () => {});
  r.setScanImage(scanCanvas());
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: [[0, 0], [W, 0], [W, H], [0, H]], area: W * H, effect, params }],
  };
  r.setShow(show);
  r.draw(1.5);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

describe("Edge glow's look (#158)", () => {
  for (const params of [{}, { spread: 1, threshold: 0.03 }, { spread: 4, threshold: 0.2, pulse: 0.5 }, { spread: 8, base: 0 }]) {
    it(`matches the per-pixel original: ${JSON.stringify(params)}`, () => {
      const a = pixels("edgeglow", params), b = pixels("edgeglowReference", params);
      let max = 0, sum = 0, lit = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        max = Math.max(max, d); sum += d;
        if (b[i] > 40) lit++;
      }
      expect(lit).toBeGreaterThan(100); // it does draw edges here
      expect(sum / a.length).toBeLessThan(0.5);
      expect(max).toBeLessThanOrEqual(8);
    });
  }

});
