import { describe, expect, it } from "vitest";
import { SoundInput } from "./mic";

/** Runs frames for up to `ms`, returning the loudest level seen. */
async function listen(s: SoundInput, ms: number): Promise<number> {
  let loudest = 0;
  const until = performance.now() + ms;
  while (performance.now() < until) {
    loudest = Math.max(loudest, s.frame(1 / 60).level);
    await new Promise((f) => requestAnimationFrame(f));
  }
  return loudest;
}

describe("SoundInput", () => {
  it("is silent while off", async () => {
    const s = new SoundInput();
    expect(await listen(s, 200)).toBe(0);
    expect(s.status()).toEqual({ level: 0, error: null });
  });

  it("hears the microphone once turned on, and goes silent when turned off", async () => {
    const s = new SoundInput();
    await s.set({ enabled: true, device: null });
    expect(await listen(s, 3000)).toBeGreaterThan(0.05); // the fake mic beeps
    expect(s.status().error).toBeNull();
    await s.set({ enabled: false, device: null });
    expect(s.frame(1 / 60)).toEqual({ level: 0, bass: 0, mid: 0, treble: 0, beat: 0 });
  });

  it("reports a missing input instead of failing silently", async () => {
    const s = new SoundInput();
    await s.set({ enabled: true, device: "no-such-device" });
    expect(s.status().error).toMatch(/not available/i);
    expect(s.frame(1 / 60).level).toBe(0);
  });
});
