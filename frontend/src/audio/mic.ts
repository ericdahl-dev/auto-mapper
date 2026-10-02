// The output window's sound input: the microphone, or the playing videos' own sound, through
// Web Audio into AudioAnalyzer, once per frame.

import { AudioAnalyzer, type AudioValues, SILENT } from "./analysis";

export interface SoundSettings {
  enabled: boolean;
  device: string | null; // a browser device id; null = the default input
  source?: "mic" | "video"; // "video": react to the videos that are playing with sound, not the mic
}

// A video element can be routed into Web Audio only once, and only into one context, for good. So
// video taps live in one shared context; each tap keeps playing to the speakers through it.
// Chrome 110+ lets an AudioContext pick its output device; TypeScript's DOM types don't have it yet.
type SinkAudioContext = AudioContext & { setSinkId(id: string): Promise<void> };
let videoContext: SinkAudioContext | null = null;
let videoSink = ""; // output device for video sound routed through Web Audio; "" = the system default

/** Where video sound routed through Web Audio plays (null = system default). Returns an error
 *  message if the device can't be used; it then stays on the default. */
export async function setVideoSoundOutput(id: string | null): Promise<string | null> {
  videoSink = id ?? "";
  if (!videoContext) return null; // applied when the context is created
  try {
    await videoContext.setSinkId(videoSink);
    return null;
  } catch {
    videoSink = "";
    await videoContext.setSinkId("").catch(() => {});
    return "That sound output is not available. Pick another output.";
  }
}
const taps = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();

export class SoundInput {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AnalyserNode | null = null;
  private data = new Uint8Array(0);
  private analyzer: AudioAnalyzer | null = null;
  private last: AudioValues = SILENT;
  private error: string | null = null;
  private current = "";
  private videoMode = false;
  private tapped: MediaElementAudioSourceNode[] = [];

  /** Starts, switches or stops listening. Safe to call with unchanged settings. */
  async set(settings: SoundSettings): Promise<void> {
    const key = settings.enabled ? `on:${settings.source ?? "mic"}:${settings.device ?? ""}` : "off";
    if (key === this.current) return;
    this.current = key;
    this.stop();
    if (!settings.enabled) return;
    if (settings.source === "video") {
      this.videoMode = true;
      videoContext ??= new AudioContext(videoSink ? ({ sinkId: videoSink } as AudioContextOptions) : {}) as SinkAudioContext;
      this.ctx = videoContext;
      this.node = this.ctx.createAnalyser();
      this.node.fftSize = 2048;
      this.node.smoothingTimeConstant = 0;
      this.data = new Uint8Array(this.node.frequencyBinCount);
      this.analyzer = new AudioAnalyzer(this.ctx.sampleRate);
      this.error = NO_VIDEO_SOUND;
      await this.resume();
      return;
    }
    try {
      // Raw sound: the browser's voice processing would flatten music and kill the beat.
      const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (settings.device) audio.deviceId = { exact: settings.device };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      this.ctx = new AudioContext();
      this.node = this.ctx.createAnalyser();
      this.node.fftSize = 2048;
      this.node.smoothingTimeConstant = 0; // AudioAnalyzer smooths
      this.ctx.createMediaStreamSource(this.stream).connect(this.node);
      this.data = new Uint8Array(this.node.frequencyBinCount);
      this.analyzer = new AudioAnalyzer(this.ctx.sampleRate);
      await this.resume();
    } catch (e) {
      this.stop();
      this.error = describe(e);
    }
  }

  /** In video mode: the videos to listen to (those playing with sound). Safe to call on every update. */
  setVideos(videos: HTMLVideoElement[]) {
    if (!this.videoMode || !this.ctx || !this.node) return;
    const node = this.node;
    this.tapped.forEach((t) => t.disconnect(node));
    this.tapped = videos.map((v) => {
      let tap = taps.get(v);
      if (!tap) {
        tap = this.ctx!.createMediaElementSource(v);
        tap.connect(this.ctx!.destination); // routed through Web Audio now: keep it audible
        taps.set(v, tap);
      }
      tap.connect(node);
      return tap;
    });
    if (!videos.length) this.error = NO_VIDEO_SOUND;
    else if (running(this.ctx)) this.error = null;
  }

  /** Browsers may start audio suspended until a click in the page; call from a click handler. */
  async resume(): Promise<void> {
    if (!this.ctx || running(this.ctx)) return;
    await this.ctx.resume().catch(() => {});
    if (!running(this.ctx)) this.error = "Click the output window once to start listening.";
    else if (!this.videoMode || this.tapped.length) this.error = null;
  }

  /** This frame's sound values (all 0 when off or failed). */
  frame(dt: number): AudioValues {
    if (!this.node || !this.analyzer) return SILENT;
    this.node.getByteFrequencyData(this.data);
    this.last = this.analyzer.update(this.data, dt);
    return this.last;
  }

  status(): { level: number; error: string | null } {
    return { level: this.node ? Math.round(this.last.level * 1000) / 1000 : 0, error: this.error };
  }

  private stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.videoMode) {
      // The shared video context stays open: taps are permanent, and closing it would silence the videos.
      const node = this.node;
      if (node) this.tapped.forEach((t) => t.disconnect(node));
      this.tapped = [];
      this.videoMode = false;
    } else void this.ctx?.close().catch(() => {});
    this.stream = this.ctx = this.node = this.analyzer = null;
    this.last = SILENT;
    this.error = null;
  }
}

// A function, so TypeScript re-reads the state after resume() instead of narrowing it.
const running = (ctx: AudioContext) => ctx.state === "running";

const NO_VIDEO_SOUND = "Turn on Video sound for a playing video to react to it.";

function describe(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Microphone blocked. Allow it for this page (address bar), then turn sound on again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "That sound input is not available. Pick another input.";
  return `Couldn't start the microphone: ${e instanceof Error ? e.message : String(e)}`;
}
