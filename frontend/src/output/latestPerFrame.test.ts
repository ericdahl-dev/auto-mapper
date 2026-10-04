import { describe, expect, it } from "vitest";
import { latestPerFrame } from "./latestPerFrame";

function frames() {
  const queue: (() => void)[] = [];
  return { schedule: (fn: () => void) => void queue.push(fn), run: () => queue.splice(0).forEach((fn) => fn()), queued: () => queue.length };
}

describe("latestPerFrame (#161)", () => {
  it("applies several values pushed within a frame once, the newest", () => {
    const f = frames(), applied: number[] = [];
    const latest = latestPerFrame<number>((v) => applied.push(v), f.schedule);
    latest.push(1); latest.push(2); latest.push(3);
    expect(applied).toEqual([]);
    expect(f.queued()).toBe(1);
    f.run();
    expect(applied).toEqual([3]);
    latest.push(4); f.run();
    expect(applied).toEqual([3, 4]);
  });

  it("drops a pending value when cancelled (e.g. a scan pattern arrived after a show update)", () => {
    const f = frames(), applied: number[] = [];
    const latest = latestPerFrame<number>((v) => applied.push(v), f.schedule);
    latest.push(1); latest.cancel(); f.run();
    expect(applied).toEqual([]);
  });
});
