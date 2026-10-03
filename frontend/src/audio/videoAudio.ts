// Video sound through Web Audio: one shared context for the output window. A video element can be
// routed into Web Audio only once, and only into one context, for good, so every routed video goes
// through here: video -> sound delay -> the speakers (or the chosen sound output). Videos are only
// routed when something needs it (a sound delay, or reacting to video sound); otherwise they play
// straight from the element.

import { type ChannelChoice, routeToChannel } from "./channels";

// Chrome 110+ lets an AudioContext pick its output device; TypeScript's DOM types don't have it yet.
type SinkAudioContext = AudioContext & { setSinkId(id: string): Promise<void> };

const MAX_DELAY_SECONDS = 1;
let ctx: SinkAudioContext | null = null;
let delay: DelayNode | null = null;
let delaySeconds = 0;
let sink = ""; // output device; "" = the system default
// Each routed video: its Web Audio source, the node it feeds (its channel router), and that choice.
const taps = new WeakMap<HTMLVideoElement, { tap: MediaElementAudioSourceNode; input: AudioNode; key: string }>();
const ALL: ChannelChoice = { channel: "all", pan: 0, channels: 2 };

/** One routed video's sound, and where it should play. */
export interface SoundRoute {
  element: HTMLVideoElement;
  channel: string;
  pan: number;
}

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

/** The video's sound as a Web Audio node (routing it for good the first time), playing through its
 *  channel and the sound delay to the speakers. Connect it elsewhere too to listen to it. */
export function routeVideo(video: HTMLVideoElement, choice: ChannelChoice = ALL): MediaElementAudioSourceNode {
  const ctx = videoAudioContext();
  let routed = taps.get(video);
  const key = choice.channel === "pan" ? `pan:${choice.pan}` : `${choice.channel}:${choice.channels}`;
  if (!routed) {
    routed = { tap: ctx.createMediaElementSource(video), input: videoSoundOut(), key: "" };
    taps.set(video, routed);
  } else if (routed.key !== key) {
    routed.tap.disconnect(routed.input); // only its way to the speakers: listeners stay connected
  }
  if (routed.key !== key) {
    if (Number(choice.channel) > 2) useAllChannels(ctx);
    routed.input = routeToChannel(ctx, routed.tap, videoSoundOut(), choice);
    routed.key = key;
  }
  return routed.tap;
}

/** How many channels the sound output has (2 for most; more for a multichannel interface). */
export function outputChannels(): number {
  return videoAudioContext().destination.maxChannelCount;
}

/** Sends channels to the device as they are (channel k to output k) instead of mixing for speakers. */
function useAllChannels(ctx: AudioContext): void {
  const d = ctx.destination;
  if (d.channelCount === d.maxChannelCount && d.channelInterpretation === "discrete") return;
  d.channelCount = d.maxChannelCount;
  d.channelCountMode = "explicit";
  d.channelInterpretation = "discrete";
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

/** Applies the sound delay and each video's channel. A video is routed through Web Audio only when
 *  something needs it (a delay, or a channel other than All); otherwise it keeps playing straight
 *  from its element. Once routed, it stays routed (browsers allow no way back), set to All. */
export function applyVideoSound(ms: number, routes: SoundRoute[]): void {
  setSoundDelay(ms);
  for (const r of routes) {
    if (ms > 0 || r.channel !== "all" || isRouted(r.element)) {
      routeVideo(r.element, { channel: r.channel, pan: r.pan, channels: outputChannels() });
    }
  }
}

/** The sound delay alone, for videos playing on all channels. */
export function applySoundDelay(ms: number, audible: HTMLVideoElement[]): void {
  applyVideoSound(ms, audible.map((element) => ({ element, channel: "all", pan: 0 })));
}

/** True when routed video sound is held back until a click (the browser suspended the context). */
export function videoAudioSuspended(): boolean {
  return ctx !== null && ctx.state !== "running";
}

/** Call from a click handler: browsers may start audio suspended until one. */
export async function resumeVideoAudio(): Promise<void> {
  await ctx?.resume().catch(() => {});
}
