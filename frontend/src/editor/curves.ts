// Editing curved outlines (#31): handles only where they help, and smooth dragging along curves.

type Pt = number[];

const CORNER_DEG = 30; // a turn sharper than this at one vertex is a corner
const HANDLE_SPACING = 8; // along a curved run, one handle per this many vertices

function turnDeg(prev: Pt, p: Pt, next: Pt): number {
  const a = Math.atan2(p[1] - prev[1], p[0] - prev[0]);
  const b = Math.atan2(next[1] - p[1], next[0] - p[0]);
  let d = Math.abs(b - a) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

/** Vertices where the outline turns sharply. Points along a smooth curve are not corners. */
export function cornerIndices(polygon: Pt[]): number[] {
  const n = polygon.length;
  const corners = polygon
    .map((p, i) => (turnDeg(polygon[(i - 1 + n) % n], p, polygon[(i + 1) % n]) > CORNER_DEG ? i : -1))
    .filter((i) => i >= 0);
  return corners.length ? corners : [0];
}

/** Handles to show: every corner, plus a few spaced along each curved run. */
export function handleIndices(polygon: Pt[]): number[] {
  const n = polygon.length;
  const corners = cornerIndices(polygon);
  const handles = [...corners];
  corners.forEach((c, k) => {
    const next = k + 1 < corners.length ? corners[k + 1] : corners[0] + n;
    const run = next - c - 1;
    if (run < HANDLE_SPACING) {
      for (let i = c + 1; i < next; i++) handles.push(i % n); // short runs: every vertex
      return;
    }
    const count = Math.floor(run / HANDLE_SPACING);
    for (let h = 1; h <= count; h++) handles.push((c + Math.round((h * (run + 1)) / (count + 1))) % n);
  });
  return [...new Set(handles)].sort((a, b) => a - b);
}

/** Drags a vertex. On a curved run its neighbours follow with a smooth falloff to the run's
 *  corners, so the curve bends instead of kinking; a dragged corner moves alone. */
export function moveOnRun(polygon: Pt[], index: number, point: Pt): Pt[] {
  const n = polygon.length;
  const corners = cornerIndices(polygon);
  const target = [Math.round(point[0]), Math.round(point[1])];
  if (corners.includes(index)) return polygon.map((p, i) => (i === index ? target : p));
  // The run's ends: nearest corners before and after, walking round the outline.
  let before = 1;
  while (!corners.includes((index - before + n) % n)) before++;
  let after = 1;
  while (!corners.includes((index + after) % n)) after++;
  const dx = target[0] - polygon[index][0];
  const dy = target[1] - polygon[index][1];
  const out = polygon.slice();
  for (let k = -before + 1; k < after; k++) {
    const span = k < 0 ? before : after;
    const w = 0.5 * (1 + Math.cos((Math.PI * Math.abs(k)) / span)); // 1 at the handle, 0 at the corners
    const i = (index + k + n) % n;
    out[i] = [Math.round(polygon[i][0] + w * dx), Math.round(polygon[i][1] + w * dy)];
  }
  return out;
}


/** Index of the edge (vertex i to i+1) nearest a point. */
export function nearestEdge(polygon: Pt[], point: Pt): number {
  let best = 0;
  let bestDist = Infinity;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
    if (d < bestDist) [best, bestDist] = [i, d];
  });
  return best;
}
