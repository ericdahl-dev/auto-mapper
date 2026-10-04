import { boundingBox, offsetPolygon } from "../shared/geometry";
import earcut from "earcut";
import { type CompileResult, compileEffect, linkProgram, MAX_POLY, VERTEX } from "../effects/compile";
import { settingType } from "../effects/settingTypes";
import type { Effect } from "../effects/types";
import { type AudioValues, SILENT } from "../audio/analysis";
import { mediaSources, textSources, type UniformValue, uniformsFor } from "../effects/types";
import type { ShowMessage } from "../shared/messages";
import { MediaLibrary } from "./mediaLibrary";
import { playbackPlan } from "./playback";
import { AlignmentPass, isNeutral } from "./alignment";
import { FadeLayer, fadeProgress } from "./crossfade";
import { ScanEdges } from "./scanEdges";

export interface EffectError {
  surface: number;
  effect: string;
  log: string;
}

interface PreparedSurface {
  id: number;
  effect: Effect;
  params: Record<string, unknown>;
  bounds: [number, number, number, number];
  poly: Float32Array; // outline vertices for edge-aware effects (at most MAX_POLY)
  polyCount: number;
  perimeter: number;
  fill: WebGLVertexArrayObject; // triangles (earcut: concave polygons are fine)
  fillCount: number;
  outline: WebGLVertexArrayObject; // line loop through pixel centers
  outlineCount: number;
  media: [string, string][]; // [param name, src] for each media param that has a file
  uniforms: Record<string, UniformValue>;
}

// Texture unit 0 is the scan; media params take the units after it.
const EDGES_UNIT = 1; // the scan's precomputed edges (scanEdges.ts)
const FIRST_MEDIA_UNIT = 2;

// Plain color, used for outlines and the selection highlight.
const SOLID = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 color;
void main() { color = u_color; }`;

const ERROR_RGBA = [1, 0.15, 0.15, 1];

/** A prepared surface, the show data it was made from (as a key), and the GPU objects it owns. */
interface Prepared { key: string; surface: PreparedSurface; buffers: WebGLBuffer[]; vaos: WebGLVertexArrayObject[] }

/** Draws a show: each surface polygon filled with its effect, in projector pixels. */
export class ShowRenderer {
  private programs = new Map<string, CompileResult>();
  private reported = new Set<string>();
  private solid: WebGLProgram;
  private surfaces: PreparedSurface[] = [];
  private show: ShowMessage | null = null;
  private scanTexture: WebGLTexture;
  private blank: WebGLTexture; // 1x1 black, for media params with no file
  private buffers: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  /** Images, videos and text textures, shared by every surface showing them. */
  readonly media: MediaLibrary;
  private frame = 0;
  private aligner: AlignmentPass | null = null;
  /** The scene being left while crossfading to a new one (Play mode), with its GPU objects. */
  private fade: { surfaces: PreparedSurface[]; buffers: WebGLBuffer[]; vaos: WebGLVertexArrayObject[]; seconds: number; start: number | null } | null = null;
  private fadeLayer: FadeLayer | null = null;
  private audio: AudioValues = SILENT;
  private edges: ScanEdges | null = null; // made on first use by an effect with scanEdges
  private prepared = new Map<number, Prepared>(); // by surface id: kept while it's unchanged (#161)

  constructor(
    private gl: WebGL2RenderingContext,
    private effects: Effect[],
    private onError: (e: EffectError) => void,
  ) {
    this.media = new MediaLibrary(gl, FIRST_MEDIA_UNIT); // uploads never use unit 0: that holds the scan
    const solid = linkProgram(gl, VERTEX, SOLID);
    if (!solid.ok) throw new Error(solid.log);
    this.solid = solid.program;
    this.scanTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.scanTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  setScanImage(image: TexImageSource) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.scanTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.edges?.invalidate();
  }

  setShow(show: ShowMessage) {
    const { gl } = this;
    const seconds = show.playlist?.crossfade ?? 0;
    const newScene = this.show !== null && show.scene !== undefined && this.show.scene !== show.scene;
    const fading = newScene && show.presentation?.mode === "play" && seconds > 0;
    if (fading) {
      // Keep the scene being left (and its GPU objects) to fade out over the new one.
      this.endFade();
      this.fade = { surfaces: this.surfaces, buffers: this.buffers, vaos: this.vaos, seconds, start: null };
    }
    // Show updates arrive on every slider move and drag frame (#161): a surface whose outline, edge,
    // effect and settings are unchanged keeps what was prepared for it; only the others are rebuilt.
    const reusable = fading ? new Map<number, Prepared>() : this.prepared;
    const next = new Map<number, Prepared>();
    this.buffers = [];
    this.vaos = [];
    this.show = show;
    this.surfaces = show.surfaces.map((s) => {
      const key = JSON.stringify([s.polygon, s.edge ?? 0, s.effect, s.params]);
      const kept = reusable.get(s.id);
      if (kept && kept.key === key) {
        next.set(s.id, kept);
        this.buffers.push(...kept.buffers);
        this.vaos.push(...kept.vaos);
        return kept.surface;
      }
      const [b0, v0] = [this.buffers.length, this.vaos.length];
      const surface = this.prepare(s);
      next.set(s.id, { key, surface, buffers: this.buffers.slice(b0), vaos: this.vaos.slice(v0) });
      return surface;
    });
    if (!fading) {
      for (const [id, old] of this.prepared) {
        if (next.get(id) === old) continue;
        old.buffers.forEach((b) => gl.deleteBuffer(b));
        old.vaos.forEach((v) => gl.deleteVertexArray(v));
      }
    }
    this.prepared = next;
    const showing = [...this.surfaces, ...(this.fade?.surfaces ?? [])];
    this.media.sync(new Set(showing.flatMap((s) => s.media.map(([, src]) => src))));
    const wants = this.surfaces.flatMap((s) => {
      const playback = s.effect.playback?.(s.params);
      return playback ? s.media.map(([, src]) => ({ src, ...playback })) : [];
    });
    // A negative sound delay plays video sound early instead (soundLead.ts); positive is videoAudio.ts.
    this.media.apply(playbackPlan(wants, show.presentation), Math.max(0, -(show.sound?.delay ?? 0)) / 1000);
  }

  /** Everything drawing a surface needs that doesn't change between frames (its GPU geometry is
   *  added to this.buffers / this.vaos). */
  private prepare(s: ShowMessage["surfaces"][number]): PreparedSurface {
    // The lit area: the outline grown or shrunk by the surface's edge setting. Effects still use the
    // real outline (u_poly, corner pins), so their geometry doesn't shift.
    const flat = offsetPolygon(s.polygon, s.edge ?? 0).flat();
    const tris = earcut(flat);
    const fillVerts = new Float32Array(tris.flatMap((i) => [flat[2 * i], flat[2 * i + 1]]));
    // Lines are rasterized through pixel centers; nudge inward so edges land on the polygon.
    const lineVerts = new Float32Array(s.polygon.flatMap(([x, y]) => [x + 0.5, y + 0.5]));
    const outline = resampleOutline(s.polygon, MAX_POLY);
    const poly = new Float32Array(MAX_POLY * 2);
    poly.set(outline.flat());
    const effect = this.effects.find((e) => e.id === s.effect) ?? this.effects[0];
    const perimeter = outline.reduce((sum, [x, y], i) => {
      const [nx, ny] = outline[(i + 1) % outline.length];
      return sum + Math.hypot(nx - x, ny - y);
    }, 0);
    return {
      poly,
      polyCount: outline.length,
      perimeter,
      id: s.id,
      effect,
      params: s.params,
      bounds: boundingBox(s.polygon),
      fill: this.vao(fillVerts),
      fillCount: fillVerts.length / 2,
      outline: this.vao(lineVerts),
      outlineCount: lineVerts.length / 2,
      media: [...Object.entries(mediaSources(effect, s.params)), ...Object.entries(textSources(effect, s.params))],
      uniforms: uniformsFor(effect, s.params, outline), // once per show update, not per frame
    };
  }

  /** Drops the show (a new project): nothing is drawn until the next one. */
  clear() {
    const { gl } = this;
    this.endFade();
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.vaos.forEach((v) => gl.deleteVertexArray(v));
    this.buffers = [];
    this.vaos = [];
    this.surfaces = [];
    this.prepared = new Map();
    this.show = null;
    this.media.sync(new Set());
  }

  /** The latest sound values, used by every following draw. */
  setAudio(values: AudioValues) {
    this.audio = values;
  }

  private bindMedia(p: WebGLProgram, s: PreparedSurface) {
    const { gl } = this;
    s.media.forEach(([name, src], i) => {
      // Videos: the current frame, uploaded once per draw however many surfaces show it.
      const size = this.media.bind(src, FIRST_MEDIA_UNIT + i, this.frame);
      gl.uniform1i(gl.getUniformLocation(p, `u_${name}`), FIRST_MEDIA_UNIT + i);
      gl.uniform2f(gl.getUniformLocation(p, `u_${name}Size`), ...size);
    });
    // Media params without a file still need their sampler off unit 0 (the scan): give them a black texture.
    for (const param of s.effect.params) {
      if (!settingType(param).texture || s.media.some(([name]) => name === param.name)) continue;
      gl.uniform1i(gl.getUniformLocation(p, `u_${param.name}`), FIRST_MEDIA_UNIT + s.media.length);
      gl.activeTexture(gl.TEXTURE0 + FIRST_MEDIA_UNIT + s.media.length);
      gl.bindTexture(gl.TEXTURE_2D, this.blank);
    }
  }

  private vao(data: Float32Array): WebGLVertexArrayObject {
    const { gl } = this;
    const vao = gl.createVertexArray()!;
    this.vaos.push(vao);
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    this.buffers.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private program(effect: Effect): CompileResult {
    let result = this.programs.get(effect.id);
    if (!result) {
      result = compileEffect(this.gl, effect);
      this.programs.set(effect.id, result);
    }
    return result;
  }

  private endFade() {
    if (!this.fade) return;
    this.fade.buffers.forEach((b) => this.gl.deleteBuffer(b));
    this.fade.vaos.forEach((v) => this.gl.deleteVertexArray(v));
    this.fade = null;
  }

  /** Draws the show; realigned or dimmed shows are drawn offscreen first, then warped (alignment.ts). */
  draw(timeSeconds: number) {
    this.frame++;
    this.media.tick();
    const a = this.show?.alignment;
    if (!this.show || isNeutral(a, this.show.width, this.show.height)) return this.drawScenes(timeSeconds);
    this.aligner ??= new AlignmentPass(this.gl);
    this.aligner.begin();
    this.drawScenes(timeSeconds);
    this.aligner.end(a!, this.show.width, this.show.height);
  }

  /** The open scene, with the scene being left fading out over it during a crossfade. */
  private drawScenes(timeSeconds: number) {
    const { gl } = this;
    const fade = this.fade;
    if (fade) fade.start ??= timeSeconds; // the fade starts with its first frame
    const progress = fade ? fadeProgress(fade.start!, fade.seconds, timeSeconds) : 1;
    if (!fade || progress >= 1 || this.show?.presentation?.blackout) {
      this.endFade();
      return this.drawShow(this.surfaces, timeSeconds, true);
    }
    const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    this.fadeLayer ??= new FadeLayer(gl);
    this.fadeLayer.begin();
    this.drawShow(fade.surfaces, timeSeconds, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    this.drawShow(this.surfaces, timeSeconds, true);
    this.fadeLayer.composite(1 - progress);
  }

  /** Draws prepared surfaces; `overlays` adds Edit mode's selection and error outlines. */
  private drawShow(surfaces: PreparedSurface[], timeSeconds: number, overlays: boolean) {
    const { gl } = this;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.show || this.show.presentation?.blackout) return;
    const editing = overlays && this.show.presentation?.mode !== "play";
    const res: [number, number] = [this.show.width, this.show.height];
    const failed: PreparedSurface[] = [];

    for (const s of surfaces) {
      if (s.effect.fragment === null) continue; // "none": leave dark
      const compiled = this.program(s.effect);
      if (!compiled.ok) {
        failed.push(s);
        const key = `${s.id}:${s.effect.id}`;
        if (!this.reported.has(key)) {
          this.reported.add(key);
          this.onError({ surface: s.id, effect: s.effect.id, log: compiled.log });
        }
        continue;
      }
      const p = compiled.program;
      gl.useProgram(p);
      gl.uniform1f(gl.getUniformLocation(p, "u_time"), timeSeconds);
      for (const [k, v] of Object.entries(this.audio)) gl.uniform1f(gl.getUniformLocation(p, `u_${k}`), v);
      gl.uniform2f(gl.getUniformLocation(p, "u_resolution"), ...res);
      gl.uniform4f(gl.getUniformLocation(p, "u_bounds"), ...s.bounds);
      gl.uniform2fv(gl.getUniformLocation(p, "u_poly"), s.poly);
      gl.uniform1i(gl.getUniformLocation(p, "u_polyCount"), s.polyCount);
      gl.uniform1f(gl.getUniformLocation(p, "u_perimeter"), s.perimeter);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.scanTexture);
      gl.uniform1i(gl.getUniformLocation(p, "u_scan"), 0);
      if (s.effect.scanEdges) {
        this.edges ??= new ScanEdges(gl);
        const name = s.effect.scanEdges.spread;
        const schema = s.effect.params.find((q) => q.name === name);
        const setting = s.params[name] ?? (schema && "default" in schema ? schema.default : 1);
        const spread = Math.max(1, Math.round(Number(setting)));
        const edges = this.edges.texture(this.scanTexture, spread, res[0], res[1]);
        gl.useProgram(p); // the edge pass used its own program
        gl.activeTexture(gl.TEXTURE0 + EDGES_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, edges);
        gl.uniform1i(gl.getUniformLocation(p, "u_scanEdges"), EDGES_UNIT);
      }
      this.bindMedia(p, s);
      for (const [name, value] of Object.entries(s.uniforms)) {
        const loc = gl.getUniformLocation(p, name);
        if (Array.isArray(value) && value.length === 9) gl.uniformMatrix3fv(loc, false, value);
        else if (Array.isArray(value)) gl.uniform3f(loc, value[0], value[1], value[2]);
        else gl.uniform1f(loc, value);
      }
      gl.bindVertexArray(s.fill);
      gl.drawArrays(gl.TRIANGLES, 0, s.fillCount);
    }

    gl.useProgram(this.solid);
    gl.uniform2f(gl.getUniformLocation(this.solid, "u_resolution"), ...res);
    const uColor = gl.getUniformLocation(this.solid, "u_color");
    for (const s of editing ? failed : []) {
      gl.uniform4f(uColor, ...(ERROR_RGBA as [number, number, number, number]));
      gl.bindVertexArray(s.outline);
      gl.drawArrays(gl.LINE_LOOP, 0, s.outlineCount);
    }

    const selected = editing ? this.surfaces.find((s) => s.id === this.show!.selected) : undefined;
    if (selected) {
      // Pulse a translucent white over the selected surface so it can be found on the wall.
      const a = 0.3 + 0.15 * Math.sin(timeSeconds * 4);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform4f(uColor, 1, 1, 1, a);
      gl.bindVertexArray(selected.fill);
      gl.drawArrays(gl.TRIANGLES, 0, selected.fillCount);
      gl.disable(gl.BLEND);
      gl.uniform4f(uColor, 1, 1, 1, 1);
      gl.bindVertexArray(selected.outline);
      gl.drawArrays(gl.LINE_LOOP, 0, selected.outlineCount);
    }
    gl.bindVertexArray(null);
  }
}

/** Fits an outline into the shader's fixed-size array by resampling it at even spacing
 *  along its length, so curves keep their shape wherever the source points were dense. */
export function resampleOutline(polygon: number[][], max: number): number[][] {
  if (polygon.length <= max) return polygon;
  const n = polygon.length;
  const seg = polygon.map((p, i) => Math.hypot(polygon[(i + 1) % n][0] - p[0], polygon[(i + 1) % n][1] - p[1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const out: number[][] = [];
  let i = 0;
  let walked = 0; // length of the outline before vertex i
  for (let k = 0; k < max; k++) {
    const target = (k * total) / max;
    while (walked + seg[i] < target && i < n - 1) walked += seg[i++];
    const t = seg[i] > 0 ? (target - walked) / seg[i] : 0;
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
