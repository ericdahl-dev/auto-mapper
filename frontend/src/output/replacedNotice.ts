/** Shown by an output window that a newer one replaced (#159). The engine follows only the newest,
 *  so this one goes dark and says why. It doesn't tell you to close it: it may be the one on the
 *  projector (#169). A click takes the projector back; it also comes back on its own when the newer
 *  window closes. */
export const REPLACED_TEXT = "Another output window is in use. Click here to use this window instead.";

export function showReplacedNotice(reclaim: () => void, root: HTMLElement = document.body): HTMLElement {
  hideReplacedNotice();
  const note = document.createElement("div");
  note.id = "replaced-notice";
  note.textContent = REPLACED_TEXT;
  note.setAttribute("role", "button");
  Object.assign(note.style, {
    position: "fixed", inset: "0", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#000", color: "#fbbf24", font: "600 32px system-ui, sans-serif", textAlign: "center",
    padding: "2em", cursor: "pointer",
  });
  note.addEventListener("click", () => {
    hideReplacedNotice();
    reclaim();
  });
  root.append(note);
  return note;
}

export function hideReplacedNotice(): void {
  document.getElementById("replaced-notice")?.remove();
}
