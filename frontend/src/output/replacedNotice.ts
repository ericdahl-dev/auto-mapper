/** Shown by an output window that a newer one replaced (#159): the engine follows only the newest, so
 *  this one goes dark and says why instead of silently showing a stale show. */
export const REPLACED_TEXT = "Another output window took over the projector: close this one.";

export function showReplacedNotice(root: HTMLElement = document.body): HTMLElement {
  const note = root.querySelector<HTMLElement>("#replaced-notice") ?? document.createElement("div");
  note.id = "replaced-notice";
  note.textContent = REPLACED_TEXT;
  note.setAttribute("role", "alert");
  Object.assign(note.style, {
    position: "fixed", inset: "0", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#000", color: "#fbbf24", font: "600 32px system-ui, sans-serif", textAlign: "center", padding: "2em",
  });
  root.append(note);
  return note;
}
