// Play/blackout controls shared by the editor and the output window.

const post = (url: string, body?: object) =>
  fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

export const toggleBlackout = () => post("/api/presentation/blackout/toggle");
export const setMode = (mode: "edit" | "play") => post("/api/presentation", { mode });

let modeOf: () => "edit" | "play" = () => "edit";
let bound = false;

/** B = blackout, P = play/edit. Ignored while typing in a field. Binding again only updates
 *  where the current mode is read from: a second listener would toggle everything twice. */
export function bindPresentationKeys(currentMode: () => "edit" | "play") {
  modeOf = currentMode;
  if (bound) return;
  bound = true;
  window.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "b" || ev.key === "B") void toggleBlackout();
    if (ev.key === "p" || ev.key === "P") void setMode(modeOf() === "play" ? "edit" : "play");
  });
}
