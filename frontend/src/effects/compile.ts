import type { Effect } from "./types";

/** Vertex shader shared by every effect: polygon vertices arrive in projector pixels. */
export const VERTEX = `#version 300 es
in vec2 a_pos;               // projector pixels, origin top-left
uniform vec2 u_resolution;   // projector size in pixels
uniform vec4 u_bounds;       // surface bounding box: x, y, width, height (projector pixels)
out vec2 v_uv;               // 0..1 across the surface's bounding box
void main() {
  v_uv = (a_pos - u_bounds.xy) / u_bounds.zw;
  vec2 clip = a_pos / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const PREAMBLE = `#version 300 es
precision highp float;
uniform float u_time;        // seconds
uniform vec2 u_resolution;   // projector size in pixels
uniform vec4 u_bounds;       // surface bounding box in projector pixels
uniform sampler2D u_scan;    // the scan image (scene as the projector sees it)
in vec2 v_uv;                // 0..1 across the surface's bounding box
out vec4 color;
`;

export function fragmentSource(effect: Effect): string {
  const uniforms = effect.params
    .map((p) => `uniform ${p.type === "color" ? "vec3" : "float"} u_${p.name};`)
    .join("\n");
  return `${PREAMBLE}${uniforms}\n${effect.fragment ?? ""}`;
}

export type CompileResult = { ok: true; program: WebGLProgram } | { ok: false; log: string };

/** Compiles an effect; failures are returned (with the GLSL log), never thrown. */
export function compileEffect(gl: WebGL2RenderingContext, effect: Effect): CompileResult {
  return linkProgram(gl, VERTEX, fragmentSource(effect));
}

export function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): CompileResult {
  const prog = gl.createProgram()!;
  const shaders: WebGLShader[] = [];
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || "shader failed to compile";
      gl.deleteShader(sh);
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(prog);
      return { ok: false, log };
    }
    gl.attachShader(prog, sh);
    shaders.push(sh);
  }
  gl.bindAttribLocation(prog, 0, "a_pos"); // every VAO feeds positions on attribute 0
  gl.linkProgram(prog);
  shaders.forEach((s) => gl.deleteShader(s));
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || "program failed to link";
    gl.deleteProgram(prog);
    return { ok: false, log };
  }
  return { ok: true, program: prog };
}
