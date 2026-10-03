// Sound early: for speakers that play late (Bluetooth, an AV receiver), a negative sound delay plays a
// video's sound from a hidden copy running ahead of the visible, muted picture. Video files are known
// in advance, so the sound can lead without holding the picture back (which would stutter). The copy is
// kept locked to the picture: small drift is taken up by nudging its speed, big gaps by seeking.
// lockCorrection is shared with sync groups (syncGroups.ts).

export interface LoopInfo {
  start: number; // seconds the video loops back to
  duration: number;
  rate: number; // the picture's playback rate
}

const SEEK_OVER = 0.1; // s: further off than this, jump (a nudge would take seconds to close it)
const TOLERANCE = 0.015; // s: closer than this, leave it
const MAX_NUDGE = 0.05; // at most 5% faster or slower: inaudible

/** Where the early sound should be: the picture's time plus the lead, wrapped around the loop. */
export function leadTarget(pictureTime: number, lead: number, loop: LoopInfo): number {
  const length = loop.duration - loop.start;
  if (!(length > 0)) return pictureTime + lead;
  return loop.start + ((((pictureTime + lead - loop.start) % length) + length) % length);
}

/** How to move a player to `target` (its time on a shared clock) and keep it there: a playback rate
 *  for small drift, or a time to seek to. Drift is measured the short way round the loop. */
export function lockCorrection(target: number, current: number, loop: LoopInfo): { rate: number } | { seek: number } {
  const length = loop.duration - loop.start;
  let drift = current - target; // > 0: ahead of where it should be
  if (length > 0) drift = ((((drift + length / 2) % length) + length) % length) - length / 2;
  if (Math.abs(drift) > SEEK_OVER) return { seek: target };
  if (Math.abs(drift) < TOLERANCE) return { rate: loop.rate };
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift / 2)); // close the gap over about two seconds
  return { rate: loop.rate * (1 + nudge) };
}

/** How to move the early sound to stay locked ahead of the picture. */
export function leadCorrection(pictureTime: number, soundTime: number, lead: number, loop: LoopInfo): { rate: number } | { seek: number } {
  return lockCorrection(leadTarget(pictureTime, lead, loop), soundTime, loop);
}
