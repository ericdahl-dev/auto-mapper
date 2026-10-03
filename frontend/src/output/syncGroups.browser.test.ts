import { describe, expect, it } from "vitest";
import { EFFECTS } from "../effects/index";
import toneVideo from "../effects/fixtures/green-with-tone.webm?url"; // 2 s
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

const other = `${toneVideo}${toneVideo.includes("?") ? "&" : "?"}copy=1`; // a second player of the same file

function show(group: string): ShowMessage {
  const surface = (id: number, src: string, x: number) => ({
    id, polygon: [[x, 0], [x + 4, 0], [x + 4, 4], [x, 4]], area: 16, effect: "media", params: { src, group },
  });
  return {
    type: "show", width: 8, height: 4, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [surface(1, toneVideo, 0), surface(2, other, 4)],
  };
}

describe("a sync group in the output", () => {
  // A player restarting at its loop point can lag for a frame (seen: one 16 ms sample 83 ms apart at a
  // 10 fps clip's wrap, #150); that blip isn't drift. Held apart for two samples in a row is.
  it("starts two videos together and pulls one back within 40 ms after it's knocked out of step", async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 8, height: 4 });
    const r = new ShowRenderer(canvas.getContext("webgl2")!, EFFECTS, () => {});
    r.setShow(show("A"));
    await r.media.whenLoaded();
    const a = r.media.element(toneVideo)!, b = r.media.element(other)!;
    b.currentTime = 0.7; // start them well apart
    let worst = 0, previous = 0, knocked = false;
    let heldAtStart = 0, heldAfter = 0; // apart in two samples running: started together; caught up again
    const start = performance.now();
    while (performance.now() - start < 10_000) {
      r.draw((performance.now() - start) / 1000);
      await new Promise((ok) => setTimeout(ok, 16));
      const t = performance.now() - start;
      if (!knocked && t > 3000) { // a stall, as a slow decode or a busy machine causes: too small to seek
        b.currentTime += 0.09;
        knocked = true;
      }
      if ((t > 1500 && t < 3000) || t > 6000) {
        const d = Math.abs(a.currentTime - b.currentTime);
        const apart = Math.min(d, a.duration - d);
        worst = Math.max(worst, apart);
        const held = Math.min(apart, previous);
        if (t < 3000) heldAtStart = Math.max(heldAtStart, held);
        else heldAfter = Math.max(heldAfter, held);
        previous = apart;
      }
    }
    expect(heldAtStart).toBeLessThan(0.04);
    // Left alone, the knock stays 25-90 ms (seeks land on frames); corrected, it's back within the lock's 15 ms.
    expect(heldAfter).toBeLessThan(0.02);
    expect(worst).toBeLessThan(0.15); // a blip is at most a frame or so
  }, 20_000);
});
