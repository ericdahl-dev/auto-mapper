import type { TestFrameKind } from "../shared/messages";

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Test frames are drawn by shader (not CSS) so the projector path is WebGL2 from day one.
const FRAG = `#version 300 es
precision highp float;
uniform int u_kind;      // 0 black, 1 white, 2 grid
uniform vec2 u_size;     // canvas size in device pixels
out vec4 color;
void main() {
  if (u_kind == 0) { color = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (u_kind == 1) { color = vec4(1.0); return; }
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
  private gl: WebGL2RenderingContext;
  private uKind: WebGLUniformLocation | null;
  private uSize: WebGLUniformLocation | null;
  private kind: TestFrameKind = "black";

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    const prog = link(gl, VERT, FRAG);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uKind = gl.getUniformLocation(prog, "u_kind");
    this.uSize = gl.getUniformLocation(prog, "u_size");
  }

  /** Canvas size in device pixels; this is what the engine treats as projector pixels. */
  resize(): { width: number; height: number } {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);
    this.canvas.width = width;
    this.canvas.height = height;
    this.draw();
    return { width, height };
  }

  showTestFrame(kind: TestFrameKind) {
    this.kind = kind;
    this.draw();
  }

  private draw() {
    const { gl } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.uKind, KIND_INDEX[this.kind]);
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
