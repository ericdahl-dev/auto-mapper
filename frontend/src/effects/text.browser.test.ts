import { describe, expect, it } from "vitest";
import { ShowRenderer } from "../output/showRenderer";
import type { ShowMessage } from "../shared/messages";
import { EFFECTS } from "./index";

const W = 96, H = 96;
// A 64x64 square surface at (16, 16), and a slanted one for corner pinning.
const SQUARE = [[16, 16], [80, 16], [80, 80], [16, 80]];

function render(params: Record<string, unknown>, time = 0, polygon = SQUARE) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: string[] = [];
  const r = new ShowRenderer(gl, EFFECTS, (e) => errors.push(e.log));
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon, area: 4096, effect: "text", params }],
  };
  r.setShow(show);
  r.draw(time);
  expect(errors).toEqual([]);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  /** Is the projector pixel (x, y) lit (text color white)? */
  const lit = (x: number, y: number) => px[((H - 1 - y) * W + x) * 4 + 1] > 128;
  const count = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (lit(x, y)) n++;
    return n;
  };
  return { lit, count };
}

describe("text effect", () => {
  it("draws the text inside the surface, in the text color, and nothing outside it", () => {
    const { count } = render({ text: "HI", color: "#ffffff", background: "#000000" });
    expect(count(16, 16, 80, 80)).toBeGreaterThan(200); // big letters filling the square
    expect(count(0, 0, 96, 16) + count(0, 80, 96, 96)).toBe(0); // outside the surface
  });

  it("fits a long line inside the surface: it spans the width and is letterboxed top and bottom", () => {
    const { count } = render({ text: "HELLO WORLD HELLO", color: "#ffffff" });
    expect(count(16, 16, 80, 36)).toBe(0); // top band: background
    expect(count(16, 60, 80, 80)).toBe(0); // bottom band: background
    expect(count(16, 36, 26, 60)).toBeGreaterThan(0); // reaches the left edge region
    expect(count(70, 36, 80, 60)).toBeGreaterThan(0); // and the right
  });

  it("shows several lines", () => {
    const one = render({ text: "HI", color: "#ffffff" });
    const two = render({ text: "HI\nHI", color: "#ffffff" });
    // Two lines are each half as tall, so the top quarter now has letters and the middle row is a gap.
    expect(one.count(16, 16, 80, 26)).toBe(0);
    expect(two.count(16, 18, 80, 30)).toBeGreaterThan(0);
  });

  it("scroll moves the text over time", () => {
    const a = render({ text: "HELLO WORLD HELLO", color: "#ffffff", motion: "scroll", speed: 0.5 }, 0);
    const b = render({ text: "HELLO WORLD HELLO", color: "#ffffff", motion: "scroll", speed: 0.5 }, 0.37);
    let differ = 0;
    for (let y = 16; y < 80; y++) for (let x = 16; x < 80; x++) if (a.lit(x, y) !== b.lit(x, y)) differ++;
    expect(differ).toBeGreaterThan(50);
  });

  it("can be corner-pinned like media", () => {
    const slant = [[40, 10], [90, 10], [56, 86], [6, 86]];
    const { count } = render({ text: "HI", color: "#ffffff", fit: "corners" }, 0, slant);
    expect(count(6, 10, 90, 86)).toBeGreaterThan(200);
  });

  it("draws nothing but the background for empty text", () => {
    expect(render({ text: "", color: "#ffffff" }).count(0, 0, 96, 96)).toBe(0);
  });
});
