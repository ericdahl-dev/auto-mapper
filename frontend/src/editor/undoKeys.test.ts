import { describe, expect, it } from "vitest";
import { undoKeyAction } from "./undoKeys";

const key = (over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; target: string }>) => ({
  key: "z", metaKey: false, ctrlKey: false, shiftKey: false, target: "BODY", ...over,
});

describe("undo shortcuts", () => {
  it("Cmd-Z undoes and Cmd-Shift-Z redoes (Ctrl on other systems)", () => {
    expect(undoKeyAction(key({ metaKey: true }))).toBe("undo");
    expect(undoKeyAction(key({ metaKey: true, shiftKey: true, key: "Z" }))).toBe("redo");
    expect(undoKeyAction(key({ ctrlKey: true }))).toBe("undo");
    expect(undoKeyAction(key({ ctrlKey: true, key: "y" }))).toBe("redo");
  });

  it("leaves plain Z and other shortcuts alone", () => {
    expect(undoKeyAction(key({}))).toBeNull();
    expect(undoKeyAction(key({ metaKey: true, key: "s" }))).toBeNull();
  });

  it("leaves typing in a field to the field's own undo", () => {
    for (const target of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(undoKeyAction(key({ metaKey: true, target }))).toBeNull();
    }
  });
});
