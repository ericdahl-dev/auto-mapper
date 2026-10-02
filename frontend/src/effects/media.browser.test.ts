import { describe, expect, it } from "vitest";
import { createMediaElement, SceneRenderer } from "../output/sceneRenderer";
import type { SceneMessage } from "../shared/messages";
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

  it("plays video frames onto the surface", async () => {
    const { r, pixel, errors } = setup({ src: await greenVideo(), fit: "stretch" });
    await r.whenMediaLoaded();
    r.draw(0);
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

/** A short solid-green webm, recorded from a canvas, as a data URL. */
async function greenVideo(): Promise<string> {
  const c = Object.assign(document.createElement("canvas"), { width: 32, height: 16 });
  const ctx = c.getContext("2d")!;
  const recorder = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((done) => (recorder.onstop = done));
  recorder.start();
  const until = performance.now() + 400;
  while (performance.now() < until) {
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, c.width, c.height);
    await new Promise((f) => requestAnimationFrame(f));
  }
  recorder.stop();
  await stopped;
  const blob = new Blob(chunks, { type: "video/webm" });
  return await new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
