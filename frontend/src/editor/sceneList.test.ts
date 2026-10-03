import { describe, expect, it } from "vitest";
import { moveScene } from "./sceneList";

describe("moving a scene in the playlist", () => {
  it("moves it one place up or down", () => {
    expect(moveScene([1, 2, 3], 3, -1)).toEqual([1, 3, 2]);
    expect(moveScene([1, 2, 3], 1, 1)).toEqual([2, 1, 3]);
  });

  it("returns null at either end, where there's nowhere to go", () => {
    expect(moveScene([1, 2, 3], 1, -1)).toBeNull();
    expect(moveScene([1, 2, 3], 3, 1)).toBeNull();
  });
});
