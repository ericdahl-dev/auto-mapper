import { describe, expect, it } from "vitest";
import { ShowRenderer } from "../output/showRenderer";
import type { ShowMessage } from "../shared/messages";
import { EFFECTS } from "./index";

const W = 64, H = 32;

/** A fake scan: left half white, right half black, or a left-to-right gradient. */
function scanCanvas(kind: "split" | "gradient"): HTMLCanvasElement {
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = c.getContext("2d")!;
  for (let x = 0; x < W; x++) {
    const v = kind === "split" ? (x < W / 2 ? 255 : 0) : Math.round((x / (W - 1)) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, H);
  }
  return c;
}

function render(effect: string, params: Record<string, unknown>, scan: HTMLCanvasElement) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: string[] = [];
  const r = new ShowRenderer(gl, EFFECTS, (e) => errors.push(e.log));
  r.setScanImage(scan);
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: [[0, 0], [W, 0], [W, H], [0, H]], area: W * H, effect, params }],
  };
  r.setShow(show);
  r.draw(0);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const rgb = (x: number, y = H / 2) => {
    const i = ((H - 1 - y) * W + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  return { rgb, errors };
}

describe("tint", () => {
  it("recolors the real surface: bright where the scan is bright, dark where it is dark", () => {
    const { rgb, errors } = render("tint", { tintColor: "#ff0000", strength: 1 }, scanCanvas("split"));
    expect(errors).toEqual([]);
    const [r, g, b] = rgb(8);
    expect(r).toBeGreaterThan(200);
    expect(g + b).toBeLessThan(40);
    expect(rgb(56)).toEqual([0, 0, 0]);
  });
});

describe("edge glow", () => {
  it("lights the real edges in the scan and leaves flat areas dark", () => {
    const { rgb, errors } = render("edgeglow", { glowColor: "#00ffff", threshold: 0.1, base: 0 }, scanCanvas("split"));
    expect(errors).toEqual([]);
    const edge = Math.max(...[30, 31, 32, 33].map((x) => rgb(x)[1]));
    expect(edge).toBeGreaterThan(150);
    expect(rgb(8)[1]).toBeLessThan(20);
    expect(rgb(56)[1]).toBeLessThan(20);
  });
});

describe("posterize", () => {
  it("turns a smooth gradient into a few flat bands", () => {
    const { rgb, errors } = render("posterize", { levels: 4, colorA: "#000000", colorB: "#ffffff" }, scanCanvas("gradient"));
    expect(errors).toEqual([]);
    const values = new Set(Array.from({ length: W }, (_, x) => rgb(x)[0]));
    expect(values.size).toBeLessThanOrEqual(4);
    expect(values.size).toBeGreaterThanOrEqual(3);
  });
});

describe("scan orientation", () => {
  it("samples the scan the right way up (row 0 is the top of the projection)", () => {
    const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, H / 2, W, H / 2);
    const { rgb } = render("tint", { tintColor: "#ffffff", strength: 1 }, c);
    expect(rgb(32, 4)[0]).toBeGreaterThan(200); // top: bright
    expect(rgb(32, 28)[0]).toBe(0); // bottom: dark
  });
});
