// The output window's microphone: Web Audio capture feeding AudioAnalyzer, once per frame.

import { AudioAnalyzer, type AudioValues, SILENT } from "./analysis";

export interface SoundSettings {
  enabled: boolean;
  device: string | null; // a browser device id; null = the default input
}

export class SoundInput {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AnalyserNode | null = null;
  private data = new Uint8Array(0);
  private analyzer: AudioAnalyzer | null = null;
  private last: AudioValues = SILENT;
  private error: string | null = null;
  private current = "";

  /** Starts, switches or stops listening. Safe to call with unchanged settings. */
  async set(settings: SoundSettings): Promise<void> {
    const key = settings.enabled ? `on:${settings.device ?? ""}` : "off";
    if (key === this.current) return;
    this.current = key;
    this.stop();
    if (!settings.enabled) return;
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

  /** Browsers may start audio suspended until a click in the page; call from a click handler. */
  async resume(): Promise<void> {
    if (!this.ctx || running(this.ctx)) return;
    await this.ctx.resume().catch(() => {});
    this.error = running(this.ctx) ? null : "Click the output window once to start listening.";
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
    void this.ctx?.close().catch(() => {});
    this.stream = this.ctx = this.node = this.analyzer = null;
    this.last = SILENT;
    this.error = null;
  }
}

// A function, so TypeScript re-reads the state after resume() instead of narrowing it.
const running = (ctx: AudioContext) => ctx.state === "running";

function describe(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Microphone blocked. Allow it for this page (address bar), then turn sound on again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "That sound input is not available. Pick another input.";
  return `Couldn't start the microphone: ${e instanceof Error ? e.message : String(e)}`;
}
