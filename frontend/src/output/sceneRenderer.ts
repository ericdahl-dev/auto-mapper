import earcut from "earcut";
import { type CompileResult, compileEffect, linkProgram, VERTEX } from "../effects/compile";
import type { Effect } from "../effects/types";
import { uniformsFor } from "../effects/types";
import type { SceneMessage } from "../shared/messages";

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
  fill: WebGLVertexArrayObject; // triangles (earcut: concave polygons are fine)
  fillCount: number;
  outline: WebGLVertexArrayObject; // line loop through pixel centres
  outlineCount: number;
}

// Plain colour, used for outlines and the selection highlight.
const SOLID = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 color;
void main() { color = u_color; }`;

const ERROR_RGBA = [1, 0.15, 0.15, 1];

/** Draws a scene: each surface polygon filled with its effect, in projector pixels. */
export class SceneRenderer {
  private programs = new Map<string, CompileResult>();
  private reported = new Set<string>();
  private solid: WebGLProgram;
  private surfaces: PreparedSurface[] = [];
  private scene: SceneMessage | null = null;
  private scanTexture: WebGLTexture;
  private buffers: WebGLBuffer[] = [];

  constructor(
    private gl: WebGL2RenderingContext,
    private effects: Effect[],
    private onError: (e: EffectError) => void,
  ) {
    const solid = linkProgram(gl, VERTEX, SOLID);
    if (!solid.ok) throw new Error(solid.log);
    this.solid = solid.program;
    this.scanTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.scanTexture);
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

  setScene(scene: SceneMessage) {
    const { gl } = this;
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.buffers = [];
    this.scene = scene;
    this.surfaces = scene.surfaces.map((s) => {
      const flat = s.polygon.flat();
      const xs = s.polygon.map((p) => p[0]);
      const ys = s.polygon.map((p) => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const tris = earcut(flat);
      const fillVerts = new Float32Array(tris.flatMap((i) => [flat[2 * i], flat[2 * i + 1]]));
      // Lines are rasterised through pixel centres; nudge inward so edges land on the polygon.
      const lineVerts = new Float32Array(s.polygon.flatMap(([x, y]) => [x + 0.5, y + 0.5]));
      return {
        id: s.id,
        effect: this.effects.find((e) => e.id === s.effect) ?? this.effects[0],
        params: s.params,
        bounds: [x0, y0, Math.max(1, Math.max(...xs) - x0), Math.max(1, Math.max(...ys) - y0)],
        fill: this.vao(fillVerts),
        fillCount: fillVerts.length / 2,
        outline: this.vao(lineVerts),
        outlineCount: lineVerts.length / 2,
      };
    });
  }

  private vao(data: Float32Array): WebGLVertexArrayObject {
    const { gl } = this;
    const vao = gl.createVertexArray()!;
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
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.scene) return;
    const res: [number, number] = [this.scene.width, this.scene.height];
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
      gl.uniform2f(gl.getUniformLocation(p, "u_resolution"), ...res);
      gl.uniform4f(gl.getUniformLocation(p, "u_bounds"), ...s.bounds);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.scanTexture);
      gl.uniform1i(gl.getUniformLocation(p, "u_scan"), 0);
      for (const [name, value] of Object.entries(uniformsFor(s.effect, s.params))) {
        const loc = gl.getUniformLocation(p, name);
        if (Array.isArray(value)) gl.uniform3f(loc, ...value);
        else gl.uniform1f(loc, value);
      }
      gl.bindVertexArray(s.fill);
      gl.drawArrays(gl.TRIANGLES, 0, s.fillCount);
    }

    gl.useProgram(this.solid);
    gl.uniform2f(gl.getUniformLocation(this.solid, "u_resolution"), ...res);
    const uColor = gl.getUniformLocation(this.solid, "u_color");
    for (const s of failed) {
      gl.uniform4f(uColor, ...(ERROR_RGBA as [number, number, number, number]));
      gl.bindVertexArray(s.outline);
      gl.drawArrays(gl.LINE_LOOP, 0, s.outlineCount);
    }

    const selected = this.surfaces.find((s) => s.id === this.scene!.selected);
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
