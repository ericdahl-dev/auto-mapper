import { describe, expect, it } from "vitest";
import { SceneRenderer } from "../output/sceneRenderer";
import type { SceneMessage } from "../shared/messages";
import { EFFECTS } from "./index";

const W = 64, H = 32;
// A 24x24 square surface at (8, 4); its center is (20, 16).
const SQUARE = [[8, 4], [32, 4], [32, 28], [8, 28]];

/** A 40x10 (4:1) image in three vertical bands: red x 0..10, green 10..30, blue 30..40. */
function stripes(): string {
  const c = Object.assign(document.createElement("canvas"), { width: 40, height: 10 });
  const ctx = c.getContext("2d")!;
  [["#ff0000", 0, 10], ["#00ff00", 10, 20], ["#0000ff", 30, 10]].forEach(([fill, x, w]) => {
    ctx.fillStyle = fill as string;
    ctx.fillRect(x as number, 0, w as number, 10);
  });
  return c.toDataURL("image/png");
}

async function render(params: Record<string, unknown>) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: string[] = [];
  const r = new SceneRenderer(gl, EFFECTS, (e) => errors.push(e.log));
  const scene: SceneMessage = {
    type: "scene", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: SQUARE, area: 576, effect: "media", params: { src: stripes(), ...params } }],
  };
  r.setScene(scene);
  await r.whenMediaLoaded();
  r.draw(0);
  expect(errors).toEqual([]);
  return (x: number, y: number) => {
    const p = new Uint8Array(4);
    gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    const [red, g, b] = p;
    if (red > 200 && g > 200 && b > 200) return "white";
    if (red > 200 && g < 60 && b < 60) return "red";
    if (g > 200 && red < 60 && b < 60) return "green";
    if (b > 200 && red < 60 && g < 60) return "blue";
    if (red + g + b < 30) return "black";
    return `rgb(${red},${g},${b})`;
  };
}

describe("media fit modes", () => {
  it("contain shows the whole image, letterboxed in the background color", async () => {
    const at = await render({ fit: "contain", background: "#ffffff" });
    expect(at(9, 16)).toBe("red"); // image spans the full width, 6 px tall around y=16
    expect(at(20, 16)).toBe("green");
    expect(at(31, 16)).toBe("blue");
    expect(at(20, 6)).toBe("white"); // letterbox above
  });

  it("original size shows the image at 1 image pixel per projector pixel, centered", async () => {
    const at = await render({ fit: "original" });
    expect(at(9, 14)).toBe("red"); // image x = 9 (image spans x 0..40, y 11..21)
    expect(at(20, 14)).toBe("green");
    expect(at(20, 6)).toBe("black"); // above the image: background
  });

  it("tile repeats the image at original size from the surface's top-left", async () => {
    const at = await render({ fit: "tile" });
    expect(at(9, 5)).toBe("red");
    expect(at(9, 15)).toBe("red"); // the next row of tiles
    expect(at(20, 6)).toBe("green");
  });
});

describe("media framing", () => {
  it("zoom scales the image about the surface's center", async () => {
    expect((await render({ fit: "stretch" }))(9, 6)).toBe("red");
    expect((await render({ fit: "stretch", zoom: 2 }))(9, 6)).toBe("green"); // left quarter now shows the middle
  });

  it("pan moves the image across the surface (fractions of the surface)", async () => {
    const at = await render({ fit: "stretch", panX: 0.5 });
    expect(at(9, 6)).toBe("black"); // the left half is now empty
    expect(at(22, 6)).toBe("red"); // the image's left edge moved to the center
  });

  it("rotate turns the image about the surface's center", async () => {
    expect((await render({ fit: "stretch", rotate: 180 }))(9, 6)).toBe("blue");
  });

  it("flip mirrors the image", async () => {
    expect((await render({ fit: "stretch", flip: "horizontal" }))(9, 6)).toBe("blue");
    expect((await render({ fit: "stretch", flip: "none" }))(9, 6)).toBe("red");
  });

  it("framing also applies to Map to corners, in the image's own space", async () => {
    expect((await render({ fit: "corners", zoom: 2 }))(9, 6)).toBe("green");
  });
});
