import { describe, expect, it } from "vitest";
import { EFFECTS } from "../effects/index";
import toneVideo from "../effects/fixtures/green-with-tone.webm?url"; // 2 s green with a 110 Hz tone
import type { SceneMessage } from "../shared/messages";
import { SceneRenderer } from "./sceneRenderer";

const SQUARE = (x: number) => [[x, 0], [x + 8, 0], [x + 8, 8], [x, 8]];

function scene(presentation: SceneMessage["presentation"], ...params: Record<string, unknown>[]): SceneMessage {
  return {
    type: "scene", width: 32, height: 8, selected: null, presentation,
    surfaces: params.map((p, i) => ({ id: i + 1, polygon: SQUARE(i * 10), area: 64, effect: "media", params: { src: toneVideo, fit: "stretch", ...p } })),
  };
}

async function renderer(msg: SceneMessage) {
  const canvas = Object.assign(document.createElement("canvas"), { width: 32, height: 8 });
  const r = new SceneRenderer(canvas.getContext("webgl2")!, EFFECTS, () => {});
  r.setScene(msg);
  await r.whenMediaLoaded();
  return r;
}

const PLAY = { mode: "play", blackout: false } as const;

describe("video sound", () => {
  it("is off by default: videos stay muted, so existing projects stay silent", async () => {
    const r = await renderer(scene(PLAY, {}));
    expect(r.playback(toneVideo)).toMatchObject({ muted: true });
  });

  it("plays at the chosen volume in Play mode when the surface turns sound on", async () => {
    const r = await renderer(scene(PLAY, { sound: "on", volume: 0.4 }));
    expect(r.playback(toneVideo)).toMatchObject({ muted: false, volume: 0.4 });
  });

  it("is muted while editing and during blackout", async () => {
    const r = await renderer(scene({ mode: "edit", blackout: false }, { sound: "on" }));
    expect(r.playback(toneVideo)).toMatchObject({ muted: true });
    r.setScene(scene({ mode: "play", blackout: true }, { sound: "on" }));
    expect(r.playback(toneVideo)).toMatchObject({ muted: true });
    r.setScene(scene(PLAY, { sound: "on" }));
    expect(r.playback(toneVideo)).toMatchObject({ muted: false });
  });

  it("plays a shared video once, at the loudest volume among the surfaces with sound on", async () => {
    const r = await renderer(scene(PLAY, { sound: "on", volume: 0.3 }, { sound: "on", volume: 0.8 }, { volume: 1 }));
    expect(r.playback(toneVideo)).toMatchObject({ muted: false, volume: 0.8 });
  });
});

describe("when the browser holds sound back until a click", () => {
  it("reports a video that should be audible but isn't playing, and a click resumes it", async () => {
    const r = await renderer(scene(PLAY, { sound: "on" }));
    expect(r.soundBlocked()).toBe(false);
    r.mediaElement(toneVideo)!.pause(); // what the browser does to an unmuted autoplay without a click
    expect(r.soundBlocked()).toBe(true);
    await r.resumeMedia(); // called from the output window's click handler
    expect(r.soundBlocked()).toBe(false);
  });

  it("doesn't count muted videos", async () => {
    const r = await renderer(scene(PLAY, {}));
    r.mediaElement(toneVideo)!.pause();
    expect(r.soundBlocked()).toBe(false);
  });
});
