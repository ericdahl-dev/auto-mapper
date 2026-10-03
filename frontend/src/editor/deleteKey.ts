// Delete or Backspace deletes the selected surface and any shift-clicked ones. Fields keep the keys
// for typing; with Cmd, Ctrl or Alt held it's some other shortcut.

const FIELDS = ["INPUT", "TEXTAREA", "SELECT"];

/** The surfaces a key press deletes (selected first), or null when it deletes nothing. */
export function deleteKeyTargets(
  ev: { key: string; target: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  selected: number | null,
  multi: Set<number>,
): number[] | null {
  if (ev.key !== "Delete" && ev.key !== "Backspace") return null;
  if (ev.metaKey || ev.ctrlKey || ev.altKey || FIELDS.includes(ev.target)) return null;
  const ids = [...new Set([...(selected === null ? [] : [selected]), ...multi])];
  return ids.length ? ids : null;
}
