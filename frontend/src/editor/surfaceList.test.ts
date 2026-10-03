import { describe, expect, it } from "vitest";
import { surfaceRows } from "./surfaceList";

describe("the Surfaces list's rows", () => {
  it("give each surface's id, name and effect, dark ones marked", () => {
    expect(surfaceRows([
      { id: 1, name: "Left door", effect: "fill", params: { colorA: "#ff0000" } },
      { id: 4, effect: "none", params: {} },
    ])).toEqual([
      { id: 1, name: "Left door", effect: "Fill", dark: false, swatch: "rgba(255, 0, 0, 0.35)" },
      { id: 4, name: "Surface 4", effect: "None (dark)", dark: true, swatch: null },
    ]);
  });
});
