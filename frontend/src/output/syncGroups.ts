// Sync groups: videos in the same group (a per-surface setting) start together and stay together,
// e.g. one soundtrack split over two walls. Each video is its own player that loads, loops and drifts
// on its own, so the group waits until all of them can play, starts them at once on a shared clock,
// then keeps each locked to where that clock says it should be (lockCorrection: nudge the speed for
// small drift, seek for a big gap). Each video loops on its own length, anchored to the clock, so
// videos of the same length loop together and drift never builds up across loops.

import { lockCorrection } from "./soundLead";

/** The parts of a video element sync groups use (an interface, so tests can simulate a clock). */
export interface Player {
  currentTime: number;
  duration: number;
  playbackRate: number;
  paused: boolean;
  readyState: number;
  play(): Promise<void>;
  pause(): void;
}

export interface Member {
  group: string;
  player: Player;
  start: number; // seconds it starts from and loops back to
  rate: number; // its speed setting
}

const CAN_PLAY = 3; // HTMLMediaElement.HAVE_FUTURE_DATA

export class SyncGroups {
  private groups = new Map<string, { players: Player[]; started: number | null }>();

  /** Once per frame, with every grouped video and the clock (seconds). */
  update(members: Member[], now: number): void {
    const byGroup = new Map<string, Member[]>();
    for (const m of members) byGroup.set(m.group, [...(byGroup.get(m.group) ?? []), m]);
    for (const name of [...this.groups.keys()]) if (!byGroup.has(name)) this.groups.delete(name);
    for (const [name, group] of byGroup) {
      let state = this.groups.get(name);
      const players = group.map((m) => m.player);
      if (!state || state.players.length !== players.length || state.players.some((p, i) => p !== players[i])) {
        state = { players, started: null }; // who's in it changed: start again together
        this.groups.set(name, state);
      }
      if (state.started === null) {
        if (group.every((m) => m.player.readyState >= CAN_PLAY)) {
          for (const m of group) {
            m.player.currentTime = m.start;
            m.player.playbackRate = m.rate;
            void m.player.play().catch(() => {});
          }
          state.started = now;
        } else {
          for (const m of group) { // hold the ones that are ready at their start
            if (!m.player.paused) m.player.pause();
            if (m.player.readyState >= 1 && Math.abs(m.player.currentTime - m.start) > 0.001) m.player.currentTime = m.start;
          }
        }
        continue;
      }
      for (const m of group) {
        const length = m.player.duration - m.start;
        if (!(length > 0)) continue;
        const target = m.start + (((now - state.started) * m.rate) % length);
        const c = lockCorrection(target, m.player.currentTime, { start: m.start, duration: m.player.duration, rate: m.rate });
        if ("seek" in c) m.player.currentTime = c.seek;
        else m.player.playbackRate = c.rate;
        if (m.player.paused) void m.player.play().catch(() => {});
      }
    }
  }
}
