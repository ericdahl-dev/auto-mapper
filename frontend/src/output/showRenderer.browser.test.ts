import { describe, expect, it } from "vitest";
import { EFFECTS } from "../effects/index";
import type { Effect } from "../effects/types";
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

const W = 64, H = 36;

function setup(extra: Effect[] = []) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const errors: { surface: number; effect: string; log: string }[] = [];
  const r = new ShowRenderer(gl, [...EFFECTS, ...extra], (e) => errors.push(e));
  const pixel = (x: number, y: number) => {
    const out = new Uint8Array(4);
    gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); // y from the top, like the engine
    return Array.from(out.slice(0, 3));
  };
  return { r, pixel, errors };
}

function show(boxEffect: string, boxParams: Record<string, unknown> = {}, selected: number | null = null): ShowMessage {
  return {
    type: "show",
    presentation: { mode: "edit", blackout: false },
    width: W,
    height: H,
    selected,
    surfaces: [
      { id: 1, polygon: [[0, 0], [W, 0], [W, H], [0, H]], area: W * H, effect: "fill", params: { colorA: "#ff0000", colorB: "#ff0000" } },
      { id: 2, polygon: [[40, 20], [60, 20], [60, 34], [40, 34]], area: 280, effect: boxEffect, params: boxParams },
    ],
  };
}

describe("ShowRenderer", () => {
  it("fills each surface with its effect, smaller surfaces on top", () => {
    const { r, pixel } = setup();
    r.setShow(show("fill", { colorA: "#00ff00", colorB: "#00ff00" }));
    r.draw(0);
    expect(pixel(10, 10)).toEqual([255, 0, 0]);
    expect(pixel(50, 27)).toEqual([0, 255, 0]);
  });

  it("projects in projector pixels with the origin at the top left", () => {
    const { r, pixel } = setup();
    r.setShow({ ...show("none"), surfaces: [show("fill", { colorA: "#00ff00", colorB: "#00ff00" }).surfaces[1]] });
    r.draw(0);
    expect(pixel(50, 27)).toEqual([0, 255, 0]); // inside the box, near the bottom right
    expect(pixel(50, 5)).toEqual([0, 0, 0]); // same x, top of the frame: dark
  });

  it("leaves surfaces with no effect dark", () => {
    const { r, pixel } = setup();
    r.setShow({ ...show("none"), surfaces: [show("none").surfaces[1]] });
    r.draw(0);
    expect(pixel(50, 27)).toEqual([0, 0, 0]);
  });

  it("isolates a broken shader to its own surface and reports it once", () => {
    const broken: Effect = { id: "broken", name: "Broken", params: [], fragment: "void main() { color = nope; }" };
    const { r, pixel, errors } = setup([broken]);
    r.setShow(show("broken"));
    r.draw(0);
    r.draw(0.1);
    expect(pixel(10, 10)).toEqual([255, 0, 0]); // the wall still renders
    expect(pixel(50, 27)).toEqual([255, 0, 0]); // the broken box is not filled (wall shows through)
    const [rr, g, b] = pixel(40, 27); // its outline is drawn
    expect(rr).toBeGreaterThan(200);
    expect(g + b).toBeLessThan(120);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ surface: 2, effect: "broken" });
    expect(errors[0].log).toMatch(/nope/);
  });

  it("highlights the selected surface", () => {
    const { r, pixel } = setup();
    r.setShow({ ...show("none", {}, 2), surfaces: [show("none").surfaces[1]] });
    r.draw(0);
    expect(pixel(50, 27)[0]).toBeGreaterThan(40); // a dark surface becomes visible when selected
  });

  it("hides the selection highlight in play mode", () => {
    const { r, pixel } = setup();
    const dark = { ...show("none", {}, 2), surfaces: [show("none").surfaces[1]] };
    r.setShow({ ...dark, presentation: { mode: "play", blackout: false } });
    r.draw(0);
    expect(pixel(50, 27)).toEqual([0, 0, 0]);
  });

  it("draws nothing at all during blackout", () => {
    const { r, pixel } = setup();
    r.setShow({ ...show("fill", { colorA: "#00ff00", colorB: "#00ff00" }), presentation: { mode: "play", blackout: true } });
    r.draw(0);
    expect(pixel(10, 10)).toEqual([0, 0, 0]);
    expect(pixel(50, 27)).toEqual([0, 0, 0]);
  });
});

describe("ShowRenderer resources", () => {
  it("frees the previous show's vertex arrays when a new show arrives", () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 36 });
    const gl = canvas.getContext("webgl2")!;
    let live = 0;
    const create = gl.createVertexArray.bind(gl);
    const del = gl.deleteVertexArray.bind(gl);
    gl.createVertexArray = () => { live++; return create(); };
    gl.deleteVertexArray = (v) => { live--; del(v); };
    const r = new ShowRenderer(gl, EFFECTS, () => {});
    for (let i = 0; i < 20; i++) r.setShow(show("fill", { colorA: "#00ff00" }));

    expect(live).toBe(4); // 2 surfaces x (fill + outline): only the current show's
  });
});
