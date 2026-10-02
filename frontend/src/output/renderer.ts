import type { Pattern, TestFrameKind } from "../shared/messages";
import { grayCodeStripe } from "./patterns";

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Test frames are drawn by shader (not CSS) so the projector path is WebGL2 from day one.
const FRAG = `#version 300 es
precision highp float;
uniform int u_kind;      // 0 black, 1 white, 2 grid, 3 stripe pattern
uniform vec2 u_size;     // canvas size in device pixels
uniform int u_axis;      // stripe axis: 0 = columns (x), 1 = rows (y)
uniform sampler2D u_stripe;  // R8, size x 1: one value per projector column or row
out vec4 color;
void main() {
  if (u_kind == 0) { color = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (u_kind == 1) { color = vec4(1.0); return; }
  if (u_kind == 3) {
    // texelFetch (exact pixel, no filtering). Rows count from the top, like the engine.
    int i = u_axis == 0 ? int(gl_FragCoord.x) : int(u_size.y) - 1 - int(gl_FragCoord.y);
    float v = texelFetch(u_stripe, ivec2(i, 0), 0).r;
    color = vec4(vec3(v), 1.0);
    return;
  }
  vec2 p = gl_FragCoord.xy;
  vec2 cell = mod(p, 120.0);
  bool line = cell.x < 2.0 || cell.y < 2.0;
  bool border = p.x < 6.0 || p.y < 6.0 || p.x > u_size.x - 6.0 || p.y > u_size.y - 6.0;
  vec2 c = abs(p - u_size * 0.5);
  bool cross = (c.x < 3.0 && c.y < 60.0) || (c.y < 3.0 && c.x < 60.0);
  vec3 col = vec3(0.0);
  if (line) col = vec3(0.35);
  if (border) col = vec3(1.0, 0.2, 0.2);
  if (cross) col = vec3(0.2, 1.0, 0.4);
  color = vec4(col, 1.0);
}`;

const KIND_INDEX: Record<TestFrameKind, number> = { black: 0, white: 1, grid: 2 };

export class OutputRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uKind: WebGLUniformLocation | null;
  private uSize: WebGLUniformLocation | null;
  private uAxis: WebGLUniformLocation | null;
  private stripe: WebGLTexture;
  private kind: number = KIND_INDEX.black;
  private axis = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    const prog = link(gl, VERT, FRAG);
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uKind = gl.getUniformLocation(prog, "u_kind");
    this.uSize = gl.getUniformLocation(prog, "u_size");
    this.uAxis = gl.getUniformLocation(prog, "u_axis");
    this.stripe = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.stripe);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(gl.getUniformLocation(prog, "u_stripe"), 0);
  }

  /** Canvas size in device pixels; this is what the engine treats as projector pixels. */
  resize(redraw = true): { width: number; height: number } {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);
    this.canvas.width = width;
    this.canvas.height = height;
    if (redraw) this.draw();
    return { width, height };
  }

  showTestFrame(kind: TestFrameKind) {
    this.kind = KIND_INDEX[kind];
    this.draw();
  }

  showPattern(p: Pattern) {
    if (p.kind !== "gray") return this.showTestFrame(p.kind);
    const { gl } = this;
    const size = p.axis === "x" ? this.canvas.width : this.canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, this.stripe);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, 1, 0, gl.RED, gl.UNSIGNED_BYTE, grayCodeStripe(size, p.bit, p.inverse));
    this.kind = 3;
    this.axis = p.axis === "x" ? 0 : 1;
    this.draw();
  }

  private draw() {
    const { gl } = this;
    gl.useProgram(this.prog); // the show renderer shares this context
    gl.bindVertexArray(null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.uKind, this.kind);
    gl.uniform1i(this.uAxis, this.axis);
    gl.uniform2f(this.uSize, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader error");
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
  return prog;
}
