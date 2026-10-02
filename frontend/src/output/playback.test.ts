import { describe, expect, it } from "vitest";
import { media } from "../effects/media";
import { playbackPlan } from "./playback";

const PLAY = { mode: "play", blackout: false } as const;
const want = (src: string, over: Partial<{ rate: number; start: number; sound: boolean; volume: number }> = {}) =>
  ({ src, rate: 1, start: 0, sound: false, volume: 1, ...over });

describe("playbackPlan", () => {
  it("plays each file once; the first surface showing it sets speed and start", () => {
    const plan = playbackPlan([want("a.mp4", { rate: 2, start: 5 }), want("a.mp4", { rate: 0.5, start: 1 }), want("b.mp4")], PLAY);
    expect(plan.get("a.mp4")).toMatchObject({ rate: 2, start: 5 });
    expect(plan.get("b.mp4")).toMatchObject({ rate: 1, start: 0 });
  });

  it("sound: on if any surface showing the file turns it on, at the loudest of their volumes", () => {
    const plan = playbackPlan([want("a.mp4", { sound: true, volume: 0.3 }), want("a.mp4", { sound: true, volume: 0.8 }), want("a.mp4", { volume: 1 })], PLAY);
    expect(plan.get("a.mp4")!.volume).toBe(0.8);
  });

  it("stays muted unless a surface turns sound on", () => {
    expect(playbackPlan([want("a.mp4", { volume: 1 })], PLAY).get("a.mp4")!.volume).toBeNull();
  });

  it("is muted while editing and during blackout", () => {
    const sound = [want("a.mp4", { sound: true })];
    expect(playbackPlan(sound, { mode: "edit", blackout: false }).get("a.mp4")!.volume).toBeNull();
    expect(playbackPlan(sound, { mode: "play", blackout: true }).get("a.mp4")!.volume).toBeNull();
  });
});

describe("the media effect's playback settings", () => {
  it("come from its settings, with defaults and ranges", () => {
    expect(media.playback!({})).toEqual({ rate: 1, start: 0, sound: false, volume: 1 });
    expect(media.playback!({ speed: 2, start: 3, sound: "on", volume: 0.5 })).toEqual({ rate: 2, start: 3, sound: true, volume: 0.5 });
    expect(media.playback!({ speed: 99, volume: -1 })).toMatchObject({ rate: 4, volume: 0 }); // clamped to the ranges
  });
});
