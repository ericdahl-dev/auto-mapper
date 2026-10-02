import { describe, expect, it } from "vitest";
import { EFFECTS } from "../effects/index";
import type { ShowMessage } from "../shared/messages";
import { ShowRenderer } from "./showRenderer";

const W = 64, H = 32;
const LEFT_HALF = [[0, 0], [32, 0], [32, 32], [0, 32]];
const IDENTITY = [[0, 0], [W, 0], [W, H], [0, H]];

function render(alignment?: { corners: number[][]; brightness: number }) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const r = new ShowRenderer(gl, EFFECTS, () => {});
  const show: ShowMessage = {
    type: "show", width: W, height: H, selected: null, presentation: { mode: "play", blackout: false },
    surfaces: [{ id: 1, polygon: LEFT_HALF, area: 1024, effect: "fill", params: { colorA: "#ffffff", colorB: "#ffffff" } }],
    ...(alignment ? { alignment } : {}),
  };
  r.setShow(show);
  r.draw(0);
  return (x: number, y: number) => {
    const p = new Uint8Array(4);
    gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return p[0];
  };
}

describe("realigning the whole show", () => {
  it("leaves the output as it is when unaligned at full brightness", () => {
    const px = render({ corners: IDENTITY, brightness: 1 });
    expect(px(10, 16)).toBeGreaterThan(250);
    expect(px(50, 16)).toBeLessThan(5);
  });

  it("moves the picture with its corners: shifting all corners right shifts the show", () => {
    const px = render({ corners: IDENTITY.map(([x, y]) => [x + 8, y]), brightness: 1 });
    expect(px(36, 16)).toBeGreaterThan(250); // was x=28, inside the white half
    expect(px(44, 16)).toBeLessThan(5); // was x=36, dark half
    expect(px(4, 16)).toBeLessThan(5); // left of the moved picture: nothing projected
  });

  it("dims the whole show with the master brightness", () => {
    const px = render({ corners: IDENTITY, brightness: 0.5 });
    expect(px(10, 16)).toBeGreaterThan(115);
    expect(px(10, 16)).toBeLessThan(140);
  });
});
