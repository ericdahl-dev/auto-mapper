// What a click on a surface does. Clicking the selected surface deselects it, but only after a moment,
// so the first click of a double-click (which adds a corner) doesn't deselect it first. The corner is
// added on the second click itself, which still counts even if the surface was redrawn in between.

export type SurfaceClick = "select" | "deselect-soon" | "add-corner" | "ignore";

export const DESELECT_DELAY_MS = 300; // about a double-click's length

export function surfaceClick(ev: { detail: number; selected: boolean }): SurfaceClick {
  if (ev.detail === 1) return ev.selected ? "deselect-soon" : "select";
  if (ev.detail === 2 && ev.selected) return "add-corner";
  return "ignore";
}
