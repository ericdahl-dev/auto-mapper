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
const FIRST_MEDIA_UNIT = 1;

// Plain color, used for outlines and the selection highlight.
const SOLID = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 color;
void main() { color = u_color; }`;

const ERROR_RGBA = [1, 0.15, 0.15, 1];

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
  private audio: AudioValues = SILENT;

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
  }

  setShow(show: ShowMessage) {
    const { gl } = this;
    // Show updates arrive on every slider move and drag frame: free the previous one's GPU objects.
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.vaos.forEach((v) => gl.deleteVertexArray(v));
    this.buffers = [];
    this.vaos = [];
    this.show = show;
    this.surfaces = show.surfaces.map((s) => {
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
    });
    this.media.sync(new Set(this.surfaces.flatMap((s) => s.media.map(([, src]) => src))));
    const wants = this.surfaces.flatMap((s) => {
      const playback = s.effect.playback?.(s.params);
      return playback ? s.media.map(([, src]) => ({ src, ...playback })) : [];
    });
    this.media.apply(playbackPlan(wants, show.presentation));
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

  draw(timeSeconds: number) {
    const { gl } = this;
    this.frame++;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.show || this.show.presentation?.blackout) return;
    const editing = this.show.presentation?.mode !== "play";
    const res: [number, number] = [this.show.width, this.show.height];
    const failed: PreparedSurface[] = [];

    for (const s of this.surfaces) {
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
