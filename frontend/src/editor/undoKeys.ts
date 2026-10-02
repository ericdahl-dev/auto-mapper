// Undo shortcuts: Cmd-Z / Cmd-Shift-Z (Ctrl-Z / Ctrl-Shift-Z or Ctrl-Y elsewhere). Fields keep
// their own undo for typing.

const FIELDS = ["INPUT", "TEXTAREA", "SELECT"];

/** What a key press asks for, given the tag name of the element it was typed into. */
export function undoKeyAction(ev: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; target: string }): "undo" | "redo" | null {
  if (!(ev.metaKey || ev.ctrlKey) || FIELDS.includes(ev.target)) return null;
  const k = ev.key.toLowerCase();
  if (k === "z") return ev.shiftKey ? "redo" : "undo";
  if (k === "y" && ev.ctrlKey) return "redo";
  return null;
}

export function bindUndoKeys(run: (action: "undo" | "redo") => void) {
  window.addEventListener("keydown", (ev) => {
    const el = ev.target as HTMLElement | null;
    const target = el?.isContentEditable ? "TEXTAREA" : (el?.tagName ?? "BODY");
    const action = undoKeyAction({ key: ev.key, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, target });
    if (!action) return;
    ev.preventDefault();
    run(action);
  });
}
