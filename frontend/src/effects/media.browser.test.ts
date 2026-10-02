import { describe, expect, it } from "vitest";
import { createMediaElement, SceneRenderer } from "../output/sceneRenderer";
import type { SceneMessage } from "../shared/messages";
import greenVideo from "./fixtures/green.webm?url"; // 1 s of solid green, 32x16 (ffmpeg lavfi color source)
import greenThenBlue from "./fixtures/green-then-blue.webm?url";
import { EFFECTS } from "./index";

const W = 64, H = 32;
// A right triangle whose bounding box is a 24x24 square at (8, 4).
const TRIANGLE = [[8, 4], [32, 4], [8, 28]];

/** A 4:1 image in three vertical bands: red (left quarter), green (middle half), blue (right quarter). */
function stripes(): string {
  const c = Object.assign(document.createElement("canvas"), { width: 40, height: 10 });
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 10, 10);
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(10, 0, 20, 10);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(30, 0, 10, 10);
  return c.toDataURL("image/png");
}

function setup(params: Record<string, unknown>) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: string[] = [];
  const r = new SceneRenderer(gl, EFFECTS, (e) => errors.push(e.log));
  const scene: SceneMessage = {
    type: "scene", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: TRIANGLE, area: 288, effect: "media", params }],
  };
  r.setScene(scene);
  const pixel = (x: number, y: number) => {
    const out = new Uint8Array(4);
    gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return Array.from(out.slice(0, 3));
  };
  return { r, pixel, errors };
}

/** Which band a pixel shows, or "black". */
function band([r, g, b]: number[]): string {
  if (r > 200 && g < 60 && b < 60) return "red";
  if (g > 200 && r < 60 && b < 60) return "green";
  if (b > 200 && r < 60 && g < 60) return "blue";
  if (r + g + b < 30) return "black";
  return `rgb(${r},${g},${b})`;
}

describe("media effect", () => {
  it("stretch maps the whole image onto the surface's bounding box", async () => {
    const { r, pixel, errors } = setup({ src: stripes(), fit: "stretch" });
    await r.whenMediaLoaded();
    r.draw(0);
    expect(errors).toEqual([]);
    expect(band(pixel(9, 6))).toBe("red"); // left edge of the box
    expect(band(pixel(20, 6))).toBe("green");
    expect(band(pixel(28, 5))).toBe("blue"); // right edge of the box
  });

  it("cover keeps the image's aspect and crops it: a square box shows only the middle", async () => {
    const { r, pixel, errors } = setup({ src: stripes(), fit: "cover" });
    await r.whenMediaLoaded();
    r.draw(0);
    expect(errors).toEqual([]);
    expect(band(pixel(9, 6))).toBe("green");
    expect(band(pixel(20, 6))).toBe("green");
    expect(band(pixel(28, 5))).toBe("green");
  });

  it("is clipped to the polygon, not its bounding box", async () => {
    const { r, pixel } = setup({ src: stripes(), fit: "stretch" });
    await r.whenMediaLoaded();
    r.draw(0);
    expect(band(pixel(30, 26))).toBe("black"); // inside the box, outside the triangle
    expect(band(pixel(50, 16))).toBe("black"); // outside the box
  });

  it("draws black, not garbage, before a file is chosen or loaded", () => {
    for (const params of [{}, { src: stripes() }]) {
      const { r, pixel, errors } = setup(params);
      r.draw(0);
      expect(errors).toEqual([]);
      expect(band(pixel(12, 8))).toBe("black");
    }
  });

  it("plays video frames onto the surface within a few redraws", async () => {
    const { r, pixel, errors } = setup({ src: greenVideo, fit: "stretch" });
    await r.whenMediaLoaded();
    // The output redraws every frame; under load the first decoded frame can lag "loadeddata" by a
    // frame or two, so what matters is that frames arrive within a few redraws.
    for (let i = 0; i < 60; i++) {
      r.draw(i / 60);
      if (pixel(12, 8)[1] > 150) break;
      await new Promise((f) => requestAnimationFrame(f));
    }
    expect(errors).toEqual([]);
    const [red, g, b] = pixel(12, 8);
    expect(g).toBeGreaterThan(150);
    expect(red + b).toBeLessThan(150);
  });
});

describe("createMediaElement", () => {
  it("makes videos that loop silently and inline, and images for everything else", () => {
    const video = createMediaElement("/api/media/loop-0123456789ab.mp4") as HTMLVideoElement;
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect([video.loop, video.muted, video.playsInline, video.autoplay]).toEqual([true, true, true, true]);
    expect(createMediaElement("/api/media/clip-0123456789ab.webm?t=1")).toBeInstanceOf(HTMLVideoElement);
    expect(createMediaElement("/api/media/wall-0123456789ab.png")).toBeInstanceOf(HTMLImageElement);
  });
});

describe("media effect: video playback", () => {
  it("starts from the chosen start time", async () => {
    // 1 s green, then 1 s blue.
    const { r, pixel } = setup({ src: greenThenBlue, fit: "stretch", start: 1.2 });
    await r.whenMediaLoaded();
    expect(r.playback(greenThenBlue)!.time).toBeGreaterThanOrEqual(1.2); // not reachable this fast from 0
    let shown: number[] = [];
    for (let i = 0; i < 60 && !(shown[2] > 150); i++) {
      r.draw(0);
      shown = pixel(12, 8);
      await new Promise((f) => requestAnimationFrame(f));
    }
    expect(shown[2]).toBeGreaterThan(150); // the blue half
  });

  it("plays at the chosen speed", async () => {
    const { r } = setup({ src: greenThenBlue, fit: "stretch", speed: 2 });
    await r.whenMediaLoaded();
    expect(r.playback(greenThenBlue)).toMatchObject({ rate: 2, start: 0 });
  });
});
