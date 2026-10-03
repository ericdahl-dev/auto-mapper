// The Editor's scene list: scenes in playlist order.

/** The playlist order after moving one scene a place up (-1) or down (+1); null at either end. */
export function moveScene(ids: number[], id: number, delta: -1 | 1): number[] | null {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
