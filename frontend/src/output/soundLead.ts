// Sound early: for speakers that play late (Bluetooth, an AV receiver), a negative sound delay plays a
// video's sound from a hidden copy running ahead of the visible, muted picture. Video files are known
// in advance, so the sound can lead without holding the picture back (which would stutter). The copy is
// kept locked to the picture: small drift is taken up by nudging its speed, big gaps by seeking.

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

/** How to move the early sound to stay locked: a playback rate, or a time to seek to. */
export function leadCorrection(pictureTime: number, soundTime: number, lead: number, loop: LoopInfo): { rate: number } | { seek: number } {
  const target = leadTarget(pictureTime, lead, loop);
  const length = loop.duration - loop.start;
  let drift = soundTime - target; // > 0: the sound is too far ahead
  if (length > 0) drift = ((((drift + length / 2) % length) + length) % length) - length / 2; // the short way round
  if (Math.abs(drift) > SEEK_OVER) return { seek: target };
  if (Math.abs(drift) < TOLERANCE) return { rate: loop.rate };
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift / 2)); // close the gap over about two seconds
  return { rate: loop.rate * (1 + nudge) };
}
