// A floating toast: the page doesn't move, so a click just after Save still lands where you aimed.
// A failure stays until closed (#171): it often says what to change on the camera, away from the screen.
export function toast(box: HTMLElement, text: string, failure = false) {
  const note = Object.assign(document.createElement("div"), { className: "banner", textContent: text });
  note.dataset.text = text;
  if (failure) {
    const close = Object.assign(document.createElement("button"), { className: "close", textContent: "×" });
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", () => note.remove());
    note.append(close);
  } else {
    setTimeout(() => note.remove(), 6000);
  }
  for (const old of [...box.children]) if ((old as HTMLElement).dataset.text === text) old.remove(); // a retry doesn't stack
  box.append(note);
}
