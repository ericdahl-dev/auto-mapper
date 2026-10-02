import { describe, expect, it } from "vitest";
import type { ClientMessage } from "./messages";

// Type-level contract for what the browser sends: `npx tsc --noEmit` (part of make test) fails on a
// wrong field. Mirrors engine/messages.py (OutputMessage).
describe("client messages", () => {
  it("are typed", () => {
    const ok: ClientMessage[] = [
      { type: "hello", role: "editor" },
      { type: "hello", role: "output", width: 1920, height: 1080 },
      { type: "pattern_shown", seq: 3 },
      { type: "output_stats", fps: 60, sound: { level: 0.5, error: null }, video_sound_blocked: false, sound_output_error: null },
      { type: "effect_error", surface: 1, effect: "fill", log: "ERROR" },
    ];
    // @ts-expect-error: a pattern acknowledgment needs its seq
    const missingSeq: ClientMessage = { type: "pattern_shown" };
    // @ts-expect-error: the surface is a number
    const wrongType: ClientMessage = { type: "effect_error", surface: "one", effect: "fill", log: "" };
    expect(ok).toHaveLength(5);
    expect([missingSeq, wrongType]).toHaveLength(2);
  });
});
