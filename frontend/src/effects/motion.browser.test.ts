import { describe, expect, it } from "vitest";
import { SceneRenderer } from "../output/sceneRenderer";
import type { SceneMessage } from "../shared/messages";
import { EFFECTS } from "./index";

const W = 96, H = 54;
const BOX = [[20, 10], [76, 10], [76, 44], [20, 44]];

function render(effect: string, params: Record<string, unknown>, t: number) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: string[] = [];
  const r = new SceneRenderer(gl, EFFECTS, (e) => errors.push(e.log));
  const scene: SceneMessage = {
    type: "scene", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: BOX, area: 56 * 34, effect, params }],
  };
  r.setScene(scene);
  r.draw(t);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const lum = (x: number, y: number) => {
    const i = ((H - 1 - y) * W + x) * 4;
    return px[i] + px[i + 1] + px[i + 2];
  };
  return { lum, errors };
}

describe("outline trace", () => {
  it("lights the polygon's edge and leaves its middle dark", () => {
    const { lum, errors } = render("outline", { width: 3, chase: 0, glow: 0 }, 0);
    expect(errors).toEqual([]);
    expect(lum(21, 27)).toBeGreaterThan(200); // just inside the left edge
    expect(lum(48, 11)).toBeGreaterThan(200); // just inside the top edge
    expect(lum(48, 27)).toBe(0); // centre
    expect(lum(5, 27)).toBe(0); // outside the polygon
  });

  it("chases a bright segment around the perimeter over time", () => {
    const a = render("outline", { width: 3, chase: 1, speed: 0.5, glow: 0 }, 0);
    const b = render("outline", { width: 3, chase: 1, speed: 0.5, glow: 0 }, 0.5);
    const edge = Array.from({ length: 50 }, (_, i) => [21 + i, 11] as const);
    const diff = edge.filter(([x, y]) => Math.abs(a.lum(x, y) - b.lum(x, y)) > 60).length;
    expect(diff).toBeGreaterThan(5);
  });
});

describe("noise flow", () => {
  it("fills the surface with moving texture", () => {
    const a = render("noise", {}, 0);
    const b = render("noise", {}, 1);
    expect(a.errors).toEqual([]);
    const inside = Array.from({ length: 40 }, (_, i) => [24 + i, 15 + (i % 25)] as const);
    const values = inside.map(([x, y]) => a.lum(x, y));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(40); // not flat
    expect(inside.some(([x, y]) => Math.abs(a.lum(x, y) - b.lum(x, y)) > 20)).toBe(true); // animates
    expect(a.lum(5, 27)).toBe(0); // clipped to the polygon
  });
});
