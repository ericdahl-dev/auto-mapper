// Video playback rules. One video element per file is shared by every surface showing it, so:
// the first surface's speed, start, sound channel and sync group win; sound is on if any surface showing the file turns it on,
// at the loudest of their volumes, and only in Play mode without blackout.

export interface VideoWant {
  src: string;
  rate: number;
  start: number;
  sound: boolean;
  volume: number;
  channel?: string; // where its sound plays (audio/channels.ts); "all" if not given
  pan?: number;
  group?: string; // sync group; "none" if not given
}

export interface VideoPlan {
  rate: number;
  start: number;
  volume: number | null; // null = muted
  channel: string;
  pan: number;
  group: string;
}

export function playbackPlan(
  wants: VideoWant[],
  presentation: { mode: "edit" | "play"; blackout: boolean },
): Map<string, VideoPlan> {
  const audible = presentation.mode === "play" && !presentation.blackout;
  const plan = new Map<string, VideoPlan>();
  for (const w of wants) {
    const p = plan.get(w.src) ?? { rate: w.rate, start: w.start, volume: null, channel: w.channel ?? "all", pan: w.pan ?? 0, group: w.group ?? "none" };
    if (audible && w.sound) p.volume = Math.max(p.volume ?? 0, w.volume);
    plan.set(w.src, p);
  }
  return plan;
}
