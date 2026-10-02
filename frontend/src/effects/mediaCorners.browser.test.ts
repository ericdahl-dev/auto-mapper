import { describe, expect, it } from "vitest";
import { ShowRenderer } from "../output/showRenderer";
import type { ShowMessage } from "../shared/messages";
import { EFFECTS } from "./index";

const W = 64, H = 32;
// A slanted parallelogram (TL, TR, BR, BL): its bounding box is far wider than the surface at any height.
const SLANT = [[20, 2], [60, 2], [44, 30], [4, 30]];

function image(paint: (ctx: CanvasRenderingContext2D) => void): string {
  const c = Object.assign(document.createElement("canvas"), { width: 40, height: 40 });
  paint(c.getContext("2d")!);
  return c.toDataURL("image/png");
}
/** Four vertical bands, left to right: red, green, blue, white. */
const bands = image((ctx) => ["#ff0000", "#00ff00", "#0000ff", "#ffffff"].forEach((c, i) => {
  ctx.fillStyle = c;
  ctx.fillRect(i * 10, 0, 10, 40);
}));
/** Top half red, bottom half blue. */
const halves = image((ctx) => {
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 40, 20);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(0, 20, 40, 20);
});

async function render(params: Record<string, unknown>) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: string[] = [];
  const r = new ShowRenderer(gl, EFFECTS, (e) => errors.push(e.log));
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: SLANT, area: 1120, effect: "media", params }],
  };
  r.setShow(show);
  await r.media.whenLoaded();
  r.draw(0);
  const name = (x: number, y: number) => {
    const p = new Uint8Array(4);
    gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    const [red, g, b] = p;
    if (red > 200 && g > 200 && b > 200) return "white";
    if (red > 200 && g < 60 && b < 60) return "red";
    if (g > 200 && red < 60 && b < 60) return "green";
    if (b > 200 && red < 60 && g < 60) return "blue";
    return `rgb(${red},${g},${b})`;
  };
  return { name, errors };
}

describe("media effect: map to corners", () => {
  it("lays the image flat on the surface's corners, following the slant", async () => {
    const { name, errors } = await render({ src: bands, fit: "corners" });
    expect(errors).toEqual([]);
    expect(name(22, 4)).toBe("red"); // just inside top-left: bounding-box mapping would show green here
    expect(name(57, 4)).toBe("white"); // just inside top-right
    expect(name(7, 28)).toBe("red"); // just inside bottom-left
    expect(name(42, 28)).toBe("white"); // just inside bottom-right: bounding-box mapping would show blue
  });

  it("keeps the image upright: top of the image at the top corners", async () => {
    const { name } = await render({ src: halves, fit: "corners" });
    expect(name(40, 5)).toBe("red");
    expect(name(24, 27)).toBe("blue");
  });

  it("uses pinned corners when set: pinning the bottom edge higher squeezes the image upward", async () => {
    // Pin the image's bottom corners at y=16: below that is outside the image (black: clamped edge would smear).
    const pin = [[20, 2], [60, 2], [52, 16], [12, 16]];
    const { name } = await render({ src: halves, fit: "corners", corners: pin });
    expect(name(36, 5)).toBe("red");
    expect(name(36, 13)).toBe("blue");
    expect(name(24, 27)).toBe("rgb(0,0,0)");
  });
});
