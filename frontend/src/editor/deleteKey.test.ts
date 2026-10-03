import { describe, expect, it } from "vitest";
import { deleteKeyTargets } from "./deleteKey";

const key = (over: Partial<{ key: string; target: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key: "Delete", target: "BODY", metaKey: false, ctrlKey: false, altKey: false, ...over });

describe("the Delete key", () => {
  it("deletes the selected surface (Delete or Backspace)", () => {
    expect(deleteKeyTargets(key(), 4, new Set())).toEqual([4]);
    expect(deleteKeyTargets(key({ key: "Backspace" }), 4, new Set())).toEqual([4]);
  });

  it("deletes every shift-clicked surface too", () => {
    expect(deleteKeyTargets(key(), 4, new Set([2, 4, 7]))).toEqual([4, 2, 7]);
    expect(deleteKeyTargets(key(), null, new Set([2, 7]))).toEqual([2, 7]);
  });

  it("does nothing with nothing selected, while typing in a field, or with a modifier", () => {
    expect(deleteKeyTargets(key(), null, new Set())).toBeNull();
    for (const target of ["INPUT", "TEXTAREA", "SELECT"]) expect(deleteKeyTargets(key({ target }), 4, new Set())).toBeNull();
    expect(deleteKeyTargets(key({ metaKey: true, key: "Backspace" }), 4, new Set())).toBeNull();
    expect(deleteKeyTargets(key({ key: "d" }), 4, new Set())).toBeNull();
  });
});
