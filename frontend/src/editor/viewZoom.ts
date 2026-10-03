// Zooming the Editor's scan view, to place points precisely: the scan and its surfaces are drawn at
// `scale` and shifted by (x, y) screen pixels inside the stage. Never smaller than fit, never past the
// scan's edge.

export interface View {
  scale: number;
  x: number; // screen pixels: where the scan's top-left corner is, relative to the stage's
  y: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 16;

function clamp(v: View, box: { width: number; height: number }): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, v.scale));
  const minX = box.width - box.width * scale, minY = box.height - box.height * scale;
  return { scale, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
}

/** Zooms by `factor` around `at` (a point in the stage, in screen pixels), keeping it under the pointer. */
export function zoomAt(v: View, at: number[], factor: number, box: { width: number; height: number }): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, v.scale * factor));
  const k = scale / v.scale;
  return clamp({ scale, x: at[0] - (at[0] - v.x) * k, y: at[1] - (at[1] - v.y) * k }, box);
}

/** Moves a zoomed view by (dx, dy) screen pixels. */
export function panBy(v: View, [dx, dy]: number[], box: { width: number; height: number }): View {
  return clamp({ ...v, x: v.x + dx, y: v.y + dy }, box);
}
