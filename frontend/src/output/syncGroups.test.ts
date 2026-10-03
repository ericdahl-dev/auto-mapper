import { describe, expect, it } from "vitest";
import { type Player, SyncGroups } from "./syncGroups";

/** A video player on a simulated clock: plays at its rate (times a drift), loops, loads after `loadAt`. */
class FakePlayer implements Player {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  readyState = 0;
  constructor(public duration: number, private loadAt = 0, private drift = 1) {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  step(now: number, dt: number) {
    if (now >= this.loadAt) this.readyState = 4;
    if (!this.paused && this.readyState >= 3) this.currentTime = (this.currentTime + dt * this.playbackRate * this.drift) % this.duration;
  }
}

/** Runs `seconds` of 60 fps frames: players advance, then the groups correct them. */
function run(groups: SyncGroups, players: FakePlayer[], members: () => Parameters<SyncGroups["update"]>[0], from: number, seconds: number) {
  let now = from;
  for (let i = 0; i < seconds * 60; i++) {
    now += 1 / 60;
    players.forEach((p) => p.step(now, 1 / 60));
    groups.update(members(), now);
  }
  return now;
}

const apart = (a: FakePlayer, b: FakePlayer) => {
  const d = Math.abs(a.currentTime - b.currentTime);
  return Math.min(d, a.duration - d);
};

describe("sync groups", () => {
  it("videos with different load times wait for each other and start together", () => {
    const a = new FakePlayer(10, 0), b = new FakePlayer(10, 1.5);
    const g = new SyncGroups();
    const members = () => [{ group: "A", player: a, start: 0, rate: 1 }, { group: "A", player: b, start: 0, rate: 1 }];
    run(g, [a, b], members, 0, 1);
    expect(a.paused).toBe(true); // b hasn't loaded: a waits at its start
    expect(a.currentTime).toBe(0);
    run(g, [a, b], members, 1, 2);
    expect(a.paused || b.paused).toBe(false);
    expect(apart(a, b)).toBeLessThan(0.04);
  });

  it("pulls back a video that drifts 50 ms within a few seconds, by nudging its speed", () => {
    const a = new FakePlayer(10), b = new FakePlayer(10, 0, 1.002); // b runs 0.2% fast
    const g = new SyncGroups();
    const members = () => [{ group: "A", player: a, start: 0, rate: 1 }, { group: "A", player: b, start: 0, rate: 1 }];
    let now = run(g, [a, b], members, 0, 1);
    b.currentTime += 0.05; // a 50 ms jump ahead
    now = run(g, [a, b], members, now, 4);
    expect(apart(a, b)).toBeLessThan(0.02);
    expect(Math.abs(b.playbackRate - 1)).toBeLessThanOrEqual(0.05); // only nudged, never far off
  });

  it("fixes a 1 s offset (after a stall) by seeking", () => {
    const a = new FakePlayer(10), b = new FakePlayer(10);
    const g = new SyncGroups();
    const members = () => [{ group: "A", player: a, start: 0, rate: 1 }, { group: "A", player: b, start: 0, rate: 1 }];
    let now = run(g, [a, b], members, 0, 1);
    b.currentTime = (b.currentTime + 1) % 10;
    now = run(g, [a, b], members, now, 0.1);
    expect(apart(a, b)).toBeLessThan(0.04);
  });

  it("stays aligned across many loops", () => {
    const a = new FakePlayer(2), b = new FakePlayer(2, 0, 0.997); // 2 s loops, b slow
    const g = new SyncGroups();
    const members = () => [{ group: "A", player: a, start: 0, rate: 1 }, { group: "A", player: b, start: 0, rate: 1 }];
    run(g, [a, b], members, 0, 30);
    expect(apart(a, b)).toBeLessThan(0.04);
  });

  it("leaves videos in no group alone", () => {
    const a = new FakePlayer(10);
    a.playbackRate = 1.5;
    const g = new SyncGroups();
    run(g, [a], () => [], 0, 1);
    expect(a.playbackRate).toBe(1.5);
  });
});
