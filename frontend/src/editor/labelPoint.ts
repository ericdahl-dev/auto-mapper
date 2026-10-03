// Where a surface's number goes: the point inside it farthest from its edges (so it's inside even for
// concave shapes, and clear of the outline; ties go to the middle), found on a grid then refined.

function insidePolygon([x, y]: number[], poly: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance([x, y]: number[], poly: number[][]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

export function labelPoint(poly: number[][]): number[] {
  if (poly.length < 3) return poly[0] ?? [0, 0];
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  let [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  let best: number[] = poly[0];
  let bestD = -Infinity;
  for (let round = 0; round < 3; round++) { // a coarse grid, then finer around the best point
    const n = 16;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = [minX + ((maxX - minX) * i) / n, minY + ((maxY - minY) * j) / n];
        if (!insidePolygon(p, poly)) continue;
        const d = edgeDistance(p, poly) - 1e-3 * Math.hypot(p[0] - cx, p[1] - cy); // ties: toward the middle
        if (d > bestD) [best, bestD] = [p, d];
      }
    }
    const w = (maxX - minX) / 8, h = (maxY - minY) / 8;
    [minX, maxX, minY, maxY] = [best[0] - w, best[0] + w, best[1] - h, best[1] + h];
  }
  return best;
}
