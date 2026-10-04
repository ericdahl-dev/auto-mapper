import { describe, expect, it } from "vitest";
import { ShowRenderer } from "../output/showRenderer";
import type { ShowMessage } from "../shared/messages";
import { EFFECTS } from "./index";

// #158: Edge glow on every surface of a scan slowed the rig. 11 surfaces tiling a 1920x1080 show,
// each with a ragged 40-point outline (like detected surfaces), drawn over a noisy scan image.
const W = 1920, H = 1080, SURFACES = 11, FRAMES = 30;

function scanCanvas(): HTMLCanvasElement {
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = ((i * 2654435761) >>> 24) & 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function outline(k: number): number[][] {
  const x0 = (k * W) / SURFACES, x1 = ((k + 1) * W) / SURFACES;
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) pts.push([x0 + ((x1 - x0) * i) / 10, (i % 2) * 3]); // ragged top
  for (let i = 0; i < 10; i++) pts.push([x1 - (i % 2) * 3, (H * i) / 10]);
  for (let i = 0; i < 10; i++) pts.push([x1 - ((x1 - x0) * i) / 10, H - (i % 2) * 3]);
  for (let i = 0; i < 10; i++) pts.push([x0 + (i % 2) * 3, H - (H * i) / 10]);
  return pts;
}

function msPerFrame(effect: string): number {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2")!;
  const r = new ShowRenderer(gl, EFFECTS, () => {});
  r.setScanImage(scanCanvas());
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: Array.from({ length: SURFACES }, (_, k) => ({
      id: k + 1, polygon: outline(k), area: (W * H) / SURFACES, effect, params: {},
    })),
  };
  r.setShow(show);
  const px = new Uint8Array(4);
  r.draw(0);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // warm up, wait for the GPU
  const start = performance.now();
  for (let f = 1; f <= FRAMES; f++) {
    r.draw(f / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // each frame finished before the next
  }
  return (performance.now() - start) / FRAMES;
}

// A benchmark: heavy (software rendering at 1080p) and timing-sensitive, so it runs only on request,
// on an otherwise idle machine:  VITE_BENCH=1 npx vitest run --project browser edgeglowSpeed
describe.runIf(import.meta.env.VITE_BENCH === "1")("Edge glow speed (#158)", () => {
  // Headless Chromium draws in software, so absolute times are far above a real GPU's; the ratio to
  // Fill (the cheapest effect) is what carries over. Before #158 it was ~2.9x.
  it("costs little more than Fill on 11 surfaces at 1920x1080", () => {
    const fill = Math.min(msPerFrame("fill"), msPerFrame("fill")); // the faster of two runs: less noise
    const glow = Math.min(msPerFrame("edgeglow"), msPerFrame("edgeglow"));
    console.log(`ms per frame, 11 surfaces at 1920x1080: fill ${fill.toFixed(2)}, edge glow ${glow.toFixed(2)} (x${(glow / fill).toFixed(2)})`);
    expect(glow / fill).toBeLessThan(1.6);
  });
});
