// Pure polygon editing helpers. Polygons are lists of [x, y] in projector pixels.

type Pt = number[];

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Inserts a point on the polygon's nearest edge. */
export function insertVertex(polygon: Pt[], point: Pt): Pt[] {
  let best = 0;
  let bestDist = Infinity;
  polygon.forEach((a, i) => {
    const d = distToSegment(point, a, polygon[(i + 1) % polygon.length]);
    if (d < bestDist) [best, bestDist] = [i, d];
  });
  const p = [Math.round(point[0]), Math.round(point[1])];
  return [...polygon.slice(0, best + 1), p, ...polygon.slice(best + 1)];
}

/** Removes a corner, keeping at least a triangle. */
export function removeVertex(polygon: Pt[], index: number): Pt[] {
  return polygon.length <= 3 ? polygon : polygon.filter((_, i) => i !== index);
}


/** Converts a mouse position over the scaled editor view into projector pixels. */
export function toProjector(
  view: { left: number; top: number; width: number; height: number },
  projector: { width: number; height: number },
  clientX: number,
  clientY: number,
): Pt {
  return [
    Math.round(((clientX - view.left) / view.width) * projector.width),
    Math.round(((clientY - view.top) / view.height) * projector.height),
  ];
}
