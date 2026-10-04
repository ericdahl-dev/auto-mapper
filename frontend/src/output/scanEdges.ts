import { linkProgram } from "../effects/compile";

// The scan image's edge strength (#158), computed once per scan, line width and size instead of by
// every Edge glow surface on every frame (8 scan reads per pixel, 11 surfaces: it slowed the rig).
// Strength is the Sobel magnitude of the scan's brightness, 0..~5.7; it's stored as sqrt(m / MAX) in
// 16 bits over two 8-bit channels: 8 bits alone left steps that Sensitivity's sharp threshold made
// visible, and the square root keeps low strengths (where those thresholds sit) precise.
// `scanEdgeAt()` in the effect preamble decodes it (keep the two in step).

export const EDGE_MAX = 6.0;

const PASS_VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const SOBEL = `#version 300 es
precision highp float;
uniform sampler2D u_scan;
uniform vec2 u_resolution;
uniform float u_spread;
uniform float u_smooth; // 0: none; n: the median of the 3x3 pixels n apart (drops specks up to ~n px)
out vec4 color;
float raw(vec2 px) { return dot(texture(u_scan, px / u_resolution).rgb, vec3(0.299, 0.587, 0.114)); }
void order(inout float a, inout float b) { float t = min(a, b); b = max(a, b); a = t; }
float lum(vec2 px) {
  if (u_smooth < 0.5) return raw(px);
  float s = u_smooth;
  float v0 = raw(px + vec2(-s, -s)), v1 = raw(px + vec2(0, -s)), v2 = raw(px + vec2(s, -s));
  float v3 = raw(px + vec2(-s, 0)), v4 = raw(px), v5 = raw(px + vec2(s, 0));
  float v6 = raw(px + vec2(-s, s)), v7 = raw(px + vec2(0, s)), v8 = raw(px + vec2(s, s));
  // Median of 9 (a 19-swap network).
  order(v1, v2); order(v4, v5); order(v7, v8); order(v0, v1); order(v3, v4); order(v6, v7);
  order(v1, v2); order(v4, v5); order(v7, v8); order(v0, v3); order(v5, v8); order(v4, v7);
  order(v3, v6); order(v1, v4); order(v2, v5); order(v4, v7); order(v4, v2); order(v6, v4);
  order(v4, v2);
  return v4;
}
void main() {
  // Row r of this texture is sampled at v = r / height, as the scan image's row r is: both read
  // top-down in projector pixels, so gl_FragCoord is the projector pixel as it stands.
  vec2 p = gl_FragCoord.xy;
  float d = u_spread;
  float tl = lum(p + vec2(-d, -d)), t = lum(p + vec2(0, -d)), tr = lum(p + vec2(d, -d));
  float l = lum(p + vec2(-d, 0)), r = lum(p + vec2(d, 0));
  float bl = lum(p + vec2(-d, d)), b = lum(p + vec2(0, d)), br = lum(p + vec2(d, d));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  float e = sqrt(clamp(length(vec2(gx, gy)) / ${EDGE_MAX.toFixed(1)}, 0.0, 1.0));
  float hi = floor(e * 255.0) / 255.0;            // 16 bits over two 8-bit channels:
  color = vec4(hi, (e - hi) * 255.0, 0.0, 1.0);   // e = r + g / 255
}`;

export class ScanEdges {
  private program: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private framebuffer: WebGLFramebuffer;
  private cache = new Map<string, WebGLTexture>(); // "spread:smoothing:width:height" -> edge texture

  constructor(private gl: WebGL2RenderingContext) {
    const linked = linkProgram(gl, PASS_VERTEX, SOBEL);
    if (!linked.ok) throw new Error(linked.log);
    this.program = linked.program;
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.framebuffer = gl.createFramebuffer()!;
  }

  /** The scan image changed: every edge texture is out of date. */
  invalidate() {
    this.cache.forEach((t) => this.gl.deleteTexture(t));
    this.cache.clear();
  }

  /** The edge texture for this line width and smoothing at this size (projector pixels), computed on
   *  first use. */
  texture(scan: WebGLTexture, spread: number, smoothing: number, width: number, height: number): WebGLTexture {
    const key = `${spread}:${smoothing}:${width}:${height}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Draw into it without disturbing what the caller has bound (a crossfade or alignment layer).
    const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scan);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_scan"), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, "u_resolution"), width, height);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_spread"), spread);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_smooth"), smoothing);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    this.cache.set(key, tex);
    return tex;
  }
}
