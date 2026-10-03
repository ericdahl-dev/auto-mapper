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
  it("keeps two videos within 40 ms of each other over 10 s of playback", async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 8, height: 4 });
    const r = new ShowRenderer(canvas.getContext("webgl2")!, EFFECTS, () => {});
    r.setShow(show("A"));
    await r.media.whenLoaded();
    const a = r.media.element(toneVideo)!, b = r.media.element(other)!;
    b.currentTime = 0.7; // start them well apart
    let worst = 0;
    const start = performance.now();
    while (performance.now() - start < 10_000) {
      r.draw((performance.now() - start) / 1000);
      await new Promise((ok) => setTimeout(ok, 16));
      if (performance.now() - start > 1500) { // after it has started them together
        const d = Math.abs(a.currentTime - b.currentTime);
        worst = Math.max(worst, Math.min(d, a.duration - d));
      }
    }
    expect(worst).toBeLessThan(0.04);
  }, 20_000);
});
