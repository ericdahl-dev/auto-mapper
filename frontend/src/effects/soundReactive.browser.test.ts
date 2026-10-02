import { describe, expect, it } from "vitest";
import type { AudioValues } from "../audio/analysis";
import { ShowRenderer } from "../output/showRenderer";
import type { ShowMessage } from "../shared/messages";
import { EFFECTS } from "./index";

const W = 48, H = 48;
const SILENCE: AudioValues = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
const LOUD: AudioValues = { level: 1, bass: 1, mid: 1, treble: 1, beat: 1 };

/** Total brightness of a frame of one effect, filling most of the canvas. */
function brightness(effect: string, params: Record<string, unknown>, audio: AudioValues): number {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const r = new ShowRenderer(gl, EFFECTS, () => {});
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: [[4, 4], [44, 4], [44, 44], [4, 44]], area: 1600, effect, params }],
  };
  r.setShow(show);
  r.setAudio(audio);
  r.draw(0.5);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px.reduce((sum, v, i) => (i % 4 === 3 ? sum : sum + v), 0);
}

describe.each(["fill", "outline", "noise"])("%s: React to sound", (effect) => {
  it("off by default: looks the same in silence and with loud sound", () => {
    expect(brightness(effect, {}, LOUD)).toBe(brightness(effect, {}, SILENCE));
  });

  it("turned up: brighter with loud sound than in silence", () => {
    expect(brightness(effect, { react: 1 }, LOUD)).toBeGreaterThan(brightness(effect, { react: 1 }, SILENCE) * 1.3);
  });
});
