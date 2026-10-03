import { afterEach, expect, it, vi } from "vitest";
import { bindPresentationKeys } from "./presentation";

afterEach(() => vi.unstubAllGlobals());

it("one key press toggles blackout once, even if keys were bound more than once", () => {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchSpy);
  bindPresentationKeys(() => "play");
  bindPresentationKeys(() => "play"); // e.g. bound again on window resize

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));

  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it("the arrow keys step to the next and previous scene", () => {
  const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchSpy);
  bindPresentationKeys(() => "play");

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));

  expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(["/api/show/scenes/next", "/api/show/scenes/previous"]);
});
