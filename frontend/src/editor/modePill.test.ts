import { describe, expect, it } from "vitest";
import { modePill } from "./modePill";

describe("the mode pill", () => {
  it("says whether the projector is live", () => {
    expect(modePill({ mode: "edit", blackout: false })).toEqual({ text: "EDIT", kind: "edit" });
    expect(modePill({ mode: "play", blackout: false })).toEqual({ text: "PLAYING", kind: "live" });
  });

  it("blackout wins: the projector shows nothing in either mode", () => {
    expect(modePill({ mode: "play", blackout: true })).toEqual({ text: "BLACKOUT", kind: "dark" });
    expect(modePill({ mode: "edit", blackout: true })).toEqual({ text: "BLACKOUT", kind: "dark" });
  });

  it("is empty before the first show", () => {
    expect(modePill(undefined)).toEqual({ text: "", kind: "none" });
  });
});
