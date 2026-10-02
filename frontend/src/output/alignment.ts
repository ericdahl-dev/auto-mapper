// Realigning the whole show: the finished frame is drawn offscreen, then drawn again with its four
// corners moved (a corner pin over everything) and dimmed by the master brightness. Lets a bumped
// projector be corrected without a rescan. Scan patterns and test frames never go through this.

import { homography } from "../effects/homography";

export interface Alignment {
  corners: number[][]; // where the output's TL, TR, BR, BL go, in projector pixels
  brightness: number; // 0..1
}

const VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform mat3 u_inverse;     // output projector pixel -> source projector pixel
uniform vec2 u_size;        // projector size in pixels
uniform vec2 u_canvas;      // drawing buffer size
uniform float u_brightness;
out vec4 color;
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y) * (u_size / u_canvas);
  vec3 h = u_inverse * vec3(p, 1.0);
  vec2 src = h.xy / h.z;
  if (h.z <= 0.0 || src.x < 0.0 || src.y < 0.0 || src.x > u_size.x || src.y > u_size.y) {
    color = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  color = vec4(texture(u_image, vec2(src.x / u_size.x, 1.0 - src.y / u_size.y)).rgb * u_brightness, 1.0);
}`;

/** True when the alignment changes nothing (corners at the projector's corners, full brightness). */
export function isNeutral(a: Alignment | undefined, width: number, height: number): boolean {
  if (!a) return true;
  const ideal = [[0, 0], [width, 0], [width, height], [0, height]];
  return a.brightness >= 1 && a.corners.every((c, i) => Math.abs(c[0] - ideal[i][0]) < 1e-6 && Math.abs(c[1] - ideal[i][1]) < 1e-6);
}

export class AlignmentPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer;
  private texture: WebGLTexture;
  private size: [number, number] = [0, 0];

  constructor(private gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? "link");
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer()!;
    this.texture = gl.createTexture()!;
  }

  /** Directs drawing offscreen; call before drawing the show. */
  begin(): void {
    const { gl } = this;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.size[0] !== w || this.size[1] !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.size = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
  }

  /** Draws the offscreen frame onto the screen with its corners moved and dimmed. */
  end(a: Alignment, width: number, height: number): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const ideal = [[0, 0], [width, 0], [width, height], [0, height]];
    const h = homography(a.corners, ideal) ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.program, "u_inverse"), false, [h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8]]);
    gl.uniform2f(gl.getUniformLocation(this.program, "u_size"), width, height);
    gl.uniform2f(gl.getUniformLocation(this.program, "u_canvas"), gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_brightness"), a.brightness);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
