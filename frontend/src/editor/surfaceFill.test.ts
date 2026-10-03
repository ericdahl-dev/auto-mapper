import { describe, expect, it } from "vitest";
import { effectById } from "../effects/index";
import { NO_EFFECT_FILL, surfaceFill } from "./surfaceFill";

const fill = (effect: string, params: Record<string, unknown> = {}) => surfaceFill(effectById(effect), params);

describe("a surface's tint on the scan", () => {
  it("is hatched, not tinted, for None (dark)", () => {
    expect(fill("none")).toBe(NO_EFFECT_FILL);
  });

  it("is a color effect's main color, see-through", () => {
    expect(fill("fill", { colorA: "#ff0000" })).toBe("rgba(255, 0, 0, 0.35)");
    expect(fill("outline", { lineColor: "#00ff00" })).toBe("rgba(0, 255, 0, 0.35)");
    expect(fill("tint", { tintColor: "#0000ff" })).toBe("rgba(0, 0, 255, 0.35)");
  });

  it("uses the effect's default color until one is chosen", () => {
    expect(fill("fill")).toBe("rgba(37, 99, 235, 0.35)"); // #2563eb
  });

  it("looks alike for the same effect and color, different for another color", () => {
    expect(fill("noise", { colorA: "#123456" })).toBe(fill("noise", { colorA: "#123456", speed: 2 }));
    expect(fill("noise", { colorA: "#123456" })).not.toBe(fill("noise", { colorA: "#654321" }));
  });

  it("is a hue of its own for an effect without a main color, whatever its settings", () => {
    expect(fill("media")).toMatch(/^hsla\(\d+, 70%, 55%, 0.35\)$/);
    expect(fill("media", { src: "/media/a.mp4" })).toBe(fill("media", { src: "/media/b.mp4" }));
    expect(fill("media")).not.toBe(fill("posterize"));
  });
});
