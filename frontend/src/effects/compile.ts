import type { Effect } from "./types";

/** Polygons with more vertices are simplified before upload (see SceneRenderer). */
export const MAX_POLY = 64;

/** Vertex shader shared by every effect: polygon vertices arrive in projector pixels. */
export const VERTEX = `#version 300 es
in vec2 a_pos;               // projector pixels, origin top-left
uniform vec2 u_resolution;   // projector size in pixels
uniform vec4 u_bounds;       // surface bounding box: x, y, width, height (projector pixels)
out vec2 v_uv;               // 0..1 across the surface's bounding box
out vec2 v_pos;              // projector pixels
void main() {
  v_uv = (a_pos - u_bounds.xy) / u_bounds.zw;
  v_pos = a_pos;
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
in vec2 v_pos;               // this pixel, in projector pixels
out vec4 color;

// The surface outline: vertices in projector pixels, and its total length.
#define MAX_POLY ${MAX_POLY}
uniform vec2 u_poly[MAX_POLY];
uniform int u_polyCount;
uniform float u_perimeter;

// Distance from p to the surface's outline; 'along' = how far round the outline the nearest point is.
float polyEdge(vec2 p, out float along) {
  float best = 1e9, walked = 0.0;
  along = 0.0;
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= u_polyCount) break;
    vec2 a = u_poly[i], b = u_poly[(i + 1) % u_polyCount];
    vec2 ab = b - a;
    float len = length(ab);
    float t = clamp(dot(p - a, ab) / max(len * len, 1e-6), 0.0, 1.0);
    float d = length(p - (a + ab * t));
    if (d < best) { best = d; along = walked + t * len; }
    walked += len;
  }
  return best;
}
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
