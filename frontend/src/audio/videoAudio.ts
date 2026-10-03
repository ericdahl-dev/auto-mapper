// Video sound through Web Audio: one shared context for the output window. A video element can be
// routed into Web Audio only once, and only into one context, for good, so every routed video goes
// through here: video -> sound delay -> the speakers (or the chosen sound output). Videos are only
// routed when something needs it (a sound delay, or reacting to video sound); otherwise they play
// straight from the element.

// Chrome 110+ lets an AudioContext pick its output device; TypeScript's DOM types don't have it yet.
type SinkAudioContext = AudioContext & { setSinkId(id: string): Promise<void> };

const MAX_DELAY_SECONDS = 1;
let ctx: SinkAudioContext | null = null;
let delay: DelayNode | null = null;
let delaySeconds = 0;
let sink = ""; // output device; "" = the system default
const taps = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();

export function videoAudioContext(): SinkAudioContext {
  if (!ctx) {
    ctx = new AudioContext(sink ? ({ sinkId: sink } as AudioContextOptions) : {}) as SinkAudioContext;
    delay = ctx.createDelay(MAX_DELAY_SECONDS);
    delay.delayTime.value = delaySeconds;
    delay.connect(ctx.destination);
  }
  return ctx;
}

/** Where routed video sound goes, after the sound delay. */
export function videoSoundOut(): AudioNode {
  videoAudioContext();
  return delay!;
}

/** The video's sound as a Web Audio node (routing it for good the first time), already playing
 *  through the sound delay to the speakers. Connect it elsewhere too to listen to it. */
export function routeVideo(video: HTMLVideoElement): MediaElementAudioSourceNode {
  let tap = taps.get(video);
  if (!tap) {
    tap = videoAudioContext().createMediaElementSource(video);
    tap.connect(videoSoundOut());
    taps.set(video, tap);
  }
  return tap;
}

export function isRouted(video: HTMLVideoElement): boolean {
  return taps.has(video);
}

/** Delays video sound so it lands with the projector's late picture (0..500 ms). */
export function setSoundDelay(ms: number): void {
  delaySeconds = Math.min(MAX_DELAY_SECONDS, Math.max(0, ms / 1000));
  if (delay && ctx) delay.delayTime.setValueAtTime(delaySeconds, ctx.currentTime);
}

/** Where routed video sound plays (null = system default). Returns an error message if the device
 *  can't be used; it then stays on the default. */
export async function setVideoSoundOutput(id: string | null): Promise<string | null> {
  sink = id ?? "";
  if (!ctx) return null; // applied when the context is created
  try {
    await ctx.setSinkId(sink);
    return null;
  } catch {
    sink = "";
    await ctx.setSinkId("").catch(() => {});
    return "That sound output is not available. Pick another output.";
  }
}

/** The output's sound delay: set it, and route the videos playing with sound through it. With no
 *  delay nothing new is routed, so video sound keeps playing straight from the elements. */
export function applySoundDelay(ms: number, audible: HTMLVideoElement[]): void {
  setSoundDelay(ms);
  if (ms > 0) audible.forEach(routeVideo);
}

/** True when routed video sound is held back until a click (the browser suspended the context). */
export function videoAudioSuspended(): boolean {
  return ctx !== null && ctx.state !== "running";
}

/** Call from a click handler: browsers may start audio suspended until one. */
export async function resumeVideoAudio(): Promise<void> {
  await ctx?.resume().catch(() => {});
}
