import { describe, expect, it } from "vitest";
import { shouldShowHint } from "./hint";

const screen = { width: 1920, height: 1080 };

describe("shouldShowHint", () => {
  it("shows while the window is a small popup", () => {
    expect(shouldShowHint({ pageFullscreen: false, window: { width: 960, height: 540 }, screen })).toBe(true);
  });

  it("hides in page fullscreen", () => {
    expect(shouldShowHint({ pageFullscreen: true, window: screen, screen })).toBe(false);
  });

  it("hides when macOS full screen makes the window fill the screen", () => {
    expect(shouldShowHint({ pageFullscreen: false, window: { width: 1920, height: 1080 }, screen })).toBe(false);
  });

  it("still shows when the browser toolbar takes part of the screen", () => {
    expect(shouldShowHint({ pageFullscreen: false, window: { width: 1920, height: 1024 }, screen })).toBe(true);
  });
});
