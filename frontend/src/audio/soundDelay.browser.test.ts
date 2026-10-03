import { describe, expect, it } from "vitest";
import toneVideo from "../effects/fixtures/green-with-tone.webm?url"; // 2 s green with a 110 Hz tone
import { applySoundDelay, isRouted, routeVideo, setSoundDelay, videoAudioContext, videoSoundOut } from "./videoAudio";

/** Plays the tone video once and returns how much later its sound reaches the speakers (after the
 *  delay) than it leaves the video (before it). One playback, so start-up jitter cancels out. */
async function delayMs(): Promise<number> {
  const ctx = videoAudioContext();
  await ctx.resume();
  const video = Object.assign(document.createElement("video"), { src: toneVideo, muted: false });
  await new Promise((ok) => video.addEventListener("canplay", ok, { once: true }));
  const probe = (node: AudioNode) => {
    const a = ctx.createAnalyser();
    a.fftSize = 256;
    node.connect(a);
    return a;
  };
  const before = probe(routeVideo(video));
  const after = probe(videoSoundOut());
  const onset: { before?: number; after?: number } = {};
  const samples = new Float32Array(256);
  const loud = (a: AnalyserNode) => (a.getFloatTimeDomainData(samples), samples.some((x) => Math.abs(x) > 0.05));
  await video.play();
  return new Promise((done) => {
    const started = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (onset.before === undefined && loud(before)) onset.before = now;
      if (onset.after === undefined && loud(after)) onset.after = now;
      if ((onset.before !== undefined && onset.after !== undefined) || now - started > 3000) {
        clearInterval(timer);
        video.pause();
        done((onset.after ?? Infinity) - (onset.before ?? 0));
      }
    }, 2);
  });
}

describe("sound delay", () => {
  it("delays video sound by the setting, so it lands with the projector's late picture", async () => {
    setSoundDelay(300);
    const delayed = await delayMs();
    setSoundDelay(0);
    expect(delayed).toBeGreaterThan(250);
    expect(delayed).toBeLessThan(380);
  });

  it("doesn't route a video through Web Audio until it has to", () => {
    const video = document.createElement("video");
    expect(isRouted(video)).toBe(false);
    routeVideo(video);
    expect(isRouted(video)).toBe(true);
  });

  it("routes the audible videos only when there is a delay to apply", () => {
    const video = document.createElement("video");
    applySoundDelay(0, [video]);
    expect(isRouted(video)).toBe(false); // plays straight from the element, as before
    applySoundDelay(80, [video]);
    expect(isRouted(video)).toBe(true);
    applySoundDelay(0, []);
  });
});
