import { describe, expect, it } from "vitest";
import { matchScreen } from "./screens";

// What Chrome's getScreenDetails() reports on the work Mac (sizes in CSS pixels).
const THUNDERBOLT = { label: "Thunderbolt Display", left: 0, top: 0, width: 2560, height: 1440, devicePixelRatio: 1 };
const LAPTOP = { label: "Built-in Retina Display", left: -1512, top: 458, width: 1512, height: 982, devicePixelRatio: 2 };
const LENOVO = { label: "P24q-10", left: 2560, top: -560, width: 1440, height: 2560, devicePixelRatio: 1 };
const SCREENS = [THUNDERBOLT, LAPTOP, LENOVO];

describe("matchScreen", () => {
  it("finds the projector's screen by name", () => {
    expect(matchScreen(SCREENS, { name: "P24q-10", width: 1440, height: 2560 })).toBe(LENOVO);
  });

  it("falls back to the one screen with the projector's size in device pixels", () => {
    const projector = { name: "AML TV", width: 1920, height: 1080 };
    const tv = { label: "", left: 2560, top: 0, width: 1920, height: 1080, devicePixelRatio: 1 };
    expect(matchScreen([THUNDERBOLT, tv], projector)).toBe(tv);
  });

  it("gives up rather than guess when nothing matches", () => {
    expect(matchScreen(SCREENS, { name: "AML TV", width: 1920, height: 1080 })).toBeNull();
  });
});
