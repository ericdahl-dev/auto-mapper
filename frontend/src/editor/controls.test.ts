import { describe, expect, it } from "vitest";
import { effectById } from "../effects/index";
import { controlsFor, mediaLabel, parseControlValue } from "./controls";

describe("controlsFor", () => {
  it("builds one control per param, using saved values over defaults", () => {
    const controls = controlsFor(effectById("fill"), { colorA: "#ff0000", angle: 45 });
    expect(controls.map((c) => [c.name, c.kind, c.value])).toEqual([
      ["colorA", "color", "#ff0000"],
      ["colorB", "color", "#2563eb"],
      ["angle", "range", 45],
      ["brightness", "range", 1],
      ["react", "range", 0],
    ]);
    expect(controls[2]).toMatchObject({ label: "Gradient angle", min: 0, max: 360, step: 1 });
  });

  it("offers a media picker, fit choice and framing controls for the media effect; the pin has none", () => {
    const controls = controlsFor(effectById("media"), { src: "/api/media/wall-0123456789ab.png" });
    expect(controls.map((c) => [c.name, c.kind])).toEqual([
      ["src", "media"], ["fit", "select"], ["zoom", "range"], ["panX", "range"], ["panY", "range"],
      ["rotate", "range"], ["flip", "select"], ["background", "color"], ["start", "range"], ["speed", "range"], ["sound", "select"], ["volume", "range"],
    ]);
    expect(controls[0].value).toBe("/api/media/wall-0123456789ab.png");
    const fit = controls[1];
    expect(fit.kind === "select" && fit.options.map((o) => o.value)).toEqual(["cover", "stretch", "corners", "contain", "original", "tile"]);
    expect(fit.value).toBe("cover");
    expect(controlsFor(effectById("media"), {})[0].value).toBe("");
  });

  it("offers a text box for the text effect's text, showing the saved text", () => {
    const controls = controlsFor(effectById("text"), { text: "Happy\nBirthday" });
    expect(controls[0]).toEqual({ name: "text", label: "Text", kind: "text", value: "Happy\nBirthday" });
    expect(controlsFor(effectById("text"), {})[0].value).toBe("Hello");
  });

  it("has no controls for an effect without params", () => {
    expect(controlsFor(effectById("none"), {})).toEqual([]);
  });
});

describe("parseControlValue", () => {
  it("keeps colors as hex and turns range input into numbers", () => {
    expect(parseControlValue("color", "#00ff00")).toBe("#00ff00");
    expect(parseControlValue("range", "12.5")).toBe(12.5);
    expect(parseControlValue("select", "stretch")).toBe("stretch");
  });
});

describe("mediaLabel", () => {
  it("shows the uploaded file's name, or that none is chosen", () => {
    expect(mediaLabel("/api/media/wall-0123456789ab.png")).toBe("wall-0123456789ab.png");
    expect(mediaLabel("")).toBe("No file chosen");
  });
});
