import { describe, expect, it } from "vitest";
import { EFFECTS } from "../effects/index";
import toneVideo from "../effects/fixtures/green-with-tone.webm?url"; // 2 s green with a 110 Hz tone
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

function show(delay: number): ShowMessage {
  return {
    type: "show", width: 8, height: 8, selected: null, presentation: { mode: "play", blackout: false },
    sound: { enabled: false, device: null, delay },
    surfaces: [{ id: 1, polygon: [[0, 0], [8, 0], [8, 8], [0, 8]], area: 64, effect: "media", params: { src: toneVideo, sound: "on", volume: 0.5 } }],
  };
}

async function setup(delay: number) {
  const canvas = Object.assign(document.createElement("canvas"), { width: 8, height: 8 });
  const r = new ShowRenderer(canvas.getContext("webgl2")!, EFFECTS, () => {});
  r.setShow(show(delay));
  await r.media.whenLoaded();
  return r;
}

describe("sound early (a negative sound delay)", () => {
  it("plays the sound from a hidden copy running ahead of the muted picture", async () => {
    const r = await setup(-200);
    const picture = r.media.element(toneVideo)!;
    const sound = r.media.soundLead(toneVideo)!;
    expect(picture.muted).toBe(true);
    expect(sound.muted).toBe(false);
    expect(sound.volume).toBeCloseTo(0.5);
    await picture.play();
    await sound.play();
    // Draw until the copy settles ahead of the picture (or give up after 5 s on a busy machine).
    const lead = () => {
      const d = sound.currentTime - picture.currentTime; // the short way round the 2 s loop
      return d > 1 ? d - picture.duration : d < -1 ? d + picture.duration : d;
    };
    const start = performance.now();
    let settled = 0;
    while (performance.now() - start < 5000 && settled < 10) {
      r.draw((performance.now() - start) / 1000);
      await new Promise((ok) => requestAnimationFrame(ok));
      settled = Math.abs(lead() - 0.2) < 0.06 ? settled + 1 : 0;
    }
    expect(lead()).toBeGreaterThan(0.12);
    expect(lead()).toBeLessThan(0.28);
    expect(r.media.audibleVideos()).toEqual([sound]); // what "React to video sound" listens to
  });

  it("is only there while the delay is negative", async () => {
    const r = await setup(-150);
    expect(r.media.soundLead(toneVideo)).not.toBeNull();
    r.setShow(show(100));
    expect(r.media.soundLead(toneVideo)).toBeNull();
    expect(r.media.element(toneVideo)!.muted).toBe(false); // the picture plays its own sound again
  });
});
