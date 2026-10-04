import { describe, expect, it } from "vitest";
import { ScanEdges } from "./scanEdges";

describe("precomputed scan edges (#158)", () => {
  it("leave the caller's drawing target and viewport as they were (crossfades and realignment draw offscreen)", () => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const scan = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, scan);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
    const layer = gl.createFramebuffer()!; // e.g. a crossfade's layer, bound while the show draws
    const target = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 32, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(1, 2, 30, 13);

    new ScanEdges(gl).texture(scan, 2, 64, 48);

    expect(gl.getParameter(gl.FRAMEBUFFER_BINDING)).toBe(layer);
    expect([...(gl.getParameter(gl.VIEWPORT) as Int32Array)]).toEqual([1, 2, 30, 13]);
  });

  it("are computed once per scan and line width, and again after a new scan", () => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const scan = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, scan);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    const edges = new ScanEdges(gl);
    const a = edges.texture(scan, 2, 64, 48);
    expect(edges.texture(scan, 2, 64, 48)).toBe(a);
    expect(edges.texture(scan, 3, 64, 48)).not.toBe(a);
    edges.invalidate();
    expect(edges.texture(scan, 2, 64, 48)).not.toBe(a);
  });
});
