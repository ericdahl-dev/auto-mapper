import { describe, expect, it } from "vitest";
import { applyVideoSound, isRouted, videoAudioContext, videoSoundOut } from "../audio/videoAudio";
import { EFFECTS } from "../effects/index";
import toneVideo from "../effects/fixtures/green-with-tone.webm?url"; // 2 s green with a 110 Hz tone
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

function show(channel: string): ShowMessage {
  return {
    type: "show", width: 8, height: 8, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: [[0, 0], [8, 0], [8, 8], [0, 8]], area: 64, effect: "media", params: { src: toneVideo, sound: "on", channel } }],
  };
}

/** The loudness reaching each speaker (left, right) while the video plays. */
async function sides(r: ShowRenderer): Promise<[number, number]> {
  const ctx = videoAudioContext();
  await ctx.resume();
  const split = ctx.createChannelSplitter(2);
  videoSoundOut().connect(split);
  const probes = [0, 1].map((i) => {
    const a = ctx.createAnalyser();
    split.connect(a, i);
    return a;
  });
  const video = r.media.element(toneVideo)!;
  await video.play();
  const peak = [0, 0];
  const buf = new Float32Array(probes[0].fftSize);
  const end = performance.now() + 600;
  while (performance.now() < end) {
    probes.forEach((p, i) => {
      p.getFloatTimeDomainData(buf);
      peak[i] = Math.max(peak[i], ...buf.map(Math.abs));
    });
    await new Promise((ok) => setTimeout(ok, 20));
  }
  video.pause();
  videoSoundOut().disconnect(split);
  return [peak[0], peak[1]];
}

describe("a surface's sound channel", () => {
  it("Left plays the video's sound on the left speaker only", async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 8, height: 8 });
    const r = new ShowRenderer(canvas.getContext("webgl2")!, EFFECTS, () => {});
    r.setShow(show("left"));
    await r.media.whenLoaded();
    applyVideoSound(0, r.media.audibleRoutes());
    const [left, right] = await sides(r);
    expect(left).toBeGreaterThan(0.05);
    expect(right).toBeLessThan(0.005);
  });

  it("All adds no routing: the video plays from its own element", async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 8, height: 8 });
    const r = new ShowRenderer(canvas.getContext("webgl2")!, EFFECTS, () => {});
    r.setShow(show("all"));
    await r.media.whenLoaded();
    applyVideoSound(0, r.media.audibleRoutes());
    expect(isRouted(r.media.element(toneVideo)!)).toBe(false);
  });
});
