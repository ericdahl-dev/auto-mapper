// The images, videos and text textures surfaces show: one texture (and, for video, one element) per
// file, shared by every surface showing it. Loads and frees them, applies the playback plan (speed,
// start, sound), routes video sound to an output device, and binds textures for drawing.

import { drawText, TEXT_KEY } from "../effects/textTexture";
import type { VideoPlan } from "./playback";
import { leadCorrection } from "./soundLead";

interface MediaTexture {
  texture: WebGLTexture;
  size: [number, number]; // 0x0 until loaded
  video: HTMLVideoElement | null;
  uploadedFrame: number; // videos: the draw that last uploaded a frame
  ready: Promise<void>; // settles on load or on error
  start: number; // videos: seconds to start from and loop back to
  lead: HTMLVideoElement | null; // sound early: a hidden copy playing the sound ahead of the muted picture
  plan: VideoPlan | null; // the last playback plan applied
}

export class MediaLibrary {
  private items = new Map<string, MediaTexture>();
  private sinkId = ""; // audio output device for video sound; "" = the system default
  private leadSeconds = 0; // how far video sound plays ahead of the picture (a negative sound delay)

  /** `uploadUnit` is a texture unit uploads may use (never 0: that holds the scan). */
  constructor(private gl: WebGL2RenderingContext, private uploadUnit: number) {}

  /** Keeps exactly these files loaded: new ones start loading, unused ones are freed. */
  sync(wanted: Set<string>): void {
    for (const [src, m] of this.items) {
      if (wanted.has(src)) continue;
      this.dropLead(m);
      m.video?.pause();
      m.video?.removeAttribute("src");
      m.video?.load(); // lets the browser drop the decoder
      this.gl.deleteTexture(m.texture);
      this.items.delete(src);
    }
    for (const src of wanted) {
      if (!this.items.has(src)) this.items.set(src, this.load(src));
    }
  }

  /** Applies speed, start and sound to the videos (see playback.ts). `leadSeconds` > 0 plays their
   *  sound that much ahead of the picture, from a hidden copy (soundLead.ts). */
  apply(plan: Map<string, VideoPlan>, leadSeconds = 0): void {
    this.leadSeconds = leadSeconds;
    for (const [src, m] of this.items) {
      const v = m.video;
      const p = plan.get(src);
      if (!v || !p) continue;
      m.plan = p;
      v.playbackRate = p.rate;
      const audible = p.volume !== null;
      const early = audible && leadSeconds > 0;
      if (early && !m.lead) m.lead = this.makeLead(src);
      if (!early) this.dropLead(m);
      v.muted = !audible || early; // sound early: the copy plays it
      const out = m.lead ?? v;
      if (m.lead) m.lead.muted = false;
      if (p.volume !== null) out.volume = p.volume;
      if (p.start !== m.start) {
        m.start = p.start;
        if (v.readyState >= v.HAVE_METADATA) v.currentTime = p.start;
      }
    }
  }

  /** Once per frame: keeps each early sound copy locked ahead of its picture. */
  tick(): void {
    for (const m of this.items.values()) {
      const v = m.video, s = m.lead;
      if (!v || !s || s.readyState < s.HAVE_METADATA || !(v.duration > 0)) continue;
      if (v.paused !== s.paused) void (v.paused ? s.pause() : s.play().catch(() => {}));
      const c = leadCorrection(v.currentTime, s.currentTime, this.leadSeconds, { start: m.start, duration: v.duration, rate: v.playbackRate });
      if ("seek" in c) s.currentTime = c.seek;
      else s.playbackRate = c.rate;
    }
  }

  /** The hidden copy playing a video's sound early, if there is one (for tests and diagnostics). */
  soundLead(src: string): HTMLVideoElement | null {
    return this.items.get(src)?.lead ?? null;
  }

  private makeLead(src: string): HTMLVideoElement {
    const s = createMediaElement(src) as HTMLVideoElement; // looping, inline; never drawn
    s.muted = false;
    if (this.sinkId) void s.setSinkId(this.sinkId).catch(() => {});
    void s.play().catch(() => {});
    return s;
  }

  private dropLead(m: MediaTexture): void {
    if (!m.lead) return;
    m.lead.pause();
    m.lead.removeAttribute("src");
    m.lead.load();
    m.lead = null;
  }

  /** Binds a file's texture to a unit (uploading the current video frame once per draw); returns its size. */
  bind(src: string, unit: number, frame: number): [number, number] {
    const { gl } = this;
    const m = this.items.get(src)!;
    const v = m.video;
    gl.activeTexture(gl.TEXTURE0 + unit); // before any upload, which binds
    if (v && m.uploadedFrame !== frame && v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth > 0) {
      this.upload(m, v);
      m.uploadedFrame = frame;
    }
    gl.bindTexture(gl.TEXTURE_2D, m.texture);
    return m.size;
  }

  /** Sends video sound to an audio output device (null = the system default). Returns an error
   *  message if that device can't be used; video sound then stays on the default. */
  async setOutputDevice(id: string | null): Promise<string | null> {
    this.sinkId = id ?? "";
    const videos = this.sound();
    try {
      await Promise.all(videos.map((v) => v.setSinkId(this.sinkId)));
      return null;
    } catch {
      this.sinkId = "";
      await Promise.all(videos.map((v) => v.setSinkId("").catch(() => {})));
      return "That sound output is not available. Pick another output.";
    }
  }

  /** Each element playing video sound, with the sound channel its surface chose (audio/channels.ts). */
  audibleRoutes(): { element: HTMLVideoElement; channel: string; pan: number }[] {
    return [...this.items.values()].flatMap((m) => {
      const element = m.lead ?? m.video;
      return element && !element.muted ? [{ element, channel: m.plan?.channel ?? "all", pan: m.plan?.pan ?? 0 }] : [];
    });
  }

  /** The elements currently playing video sound (for reacting to it, and the sound delay). */
  audibleVideos(): HTMLVideoElement[] {
    return this.sound().filter((v) => !v.muted);
  }

  /** True when a video should be heard but isn't playing: browsers pause an unmuted video until
   *  the user clicks in the page. The output window reports this so the editor can say "click". */
  soundBlocked(): boolean {
    return this.sound().some((v) => !v.muted && v.paused);
  }

  /** Restarts paused videos; call from a click handler, which lets the browser allow sound. */
  async resume(): Promise<void> {
    await Promise.all(this.sound().map((v) => v.play().catch(() => {})));
  }

  /** A video element by file (for tests and diagnostics). */
  element(src: string): HTMLVideoElement | null {
    return this.items.get(src)?.video ?? null;
  }

  /** A video's playback state (for tests and diagnostics); null for images or unknown files. */
  playback(src: string): { rate: number; start: number; time: number; muted: boolean; volume: number } | null {
    const m = this.items.get(src);
    const v = m?.video;
    return v ? { rate: v.playbackRate, start: m.start, time: v.currentTime, muted: v.muted, volume: v.volume } : null;
  }

  /** Resolves once every file has loaded (or failed to). */
  async whenLoaded(): Promise<void> {
    await Promise.all([...this.items.values()].map((m) => m.ready));
  }

  /** Every element that can play video sound: the videos and their early sound copies. */
  private sound(): HTMLVideoElement[] {
    return [...this.items.values()].flatMap((m) => [m.video, m.lead].filter((v): v is HTMLVideoElement => v !== null));
  }

  private load(src: string): MediaTexture {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    if (src.startsWith(TEXT_KEY)) {
      // Text: drawn now, no loading.
      const canvas = drawText(src);
      const m: MediaTexture = { texture, size: [canvas.width, canvas.height], video: null, uploadedFrame: -1, ready: Promise.resolve(), start: 0, lead: null, plan: null };
      gl.activeTexture(gl.TEXTURE0 + this.uploadUnit);
      this.upload(m, canvas);
      return m;
    }
    const el = createMediaElement(src);
    const video = el instanceof HTMLVideoElement ? el : null;
    if (video && this.sinkId) void video.setSinkId(this.sinkId).catch(() => {});
    const m: MediaTexture = { texture, size: [0, 0], video, uploadedFrame: -1, ready: Promise.resolve(), start: 0, lead: null, plan: null };
    m.ready = new Promise<void>((settle) => {
      el.addEventListener("error", () => settle(), { once: true });
      if (video) {
        // Looping wraps to 0: jump to the start instead (also covers a start set before loading).
        video.addEventListener("timeupdate", () => {
          if (m.start > 0 && video.currentTime < m.start - 0.05) video.currentTime = m.start;
        });
        video.addEventListener("loadeddata", () => {
          m.size = [video.videoWidth, video.videoHeight];
          if (m.start > 0) {
            // Loaded means showing the start frame: wait for the seek.
            video.addEventListener("seeked", () => settle(), { once: true });
            video.currentTime = m.start;
          } else settle();
        }, { once: true });
        void video.play().catch(() => {}); // muted, so autoplay is allowed
      } else {
        el.addEventListener("load", () => {
          const img = el as HTMLImageElement;
          if (this.items.get(src) === m) {
            gl.activeTexture(gl.TEXTURE0 + this.uploadUnit);
            this.upload(m, img);
          }
          m.size = [img.naturalWidth, img.naturalHeight];
          settle();
        }, { once: true });
      }
    });
    return m;
  }

  private upload(m: MediaTexture, source: TexImageSource) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, m.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
}

const VIDEO = /\.(mp4|m4v|mov|webm)([?#]|$)/i;

/** The element that decodes a media file: a looping, muted, inline video, or an image. */
export function createMediaElement(src: string): HTMLImageElement | HTMLVideoElement {
  if (VIDEO.test(src) || src.startsWith("data:video/")) {
    const video = document.createElement("video");
    Object.assign(video, { muted: true, loop: true, playsInline: true, autoplay: true, preload: "auto" });
    video.src = src;
    return video;
  }
  const img = new Image();
  img.src = src;
  return img;
}
