// Perspective maps between quads (corner pin). A homography is 9 numbers, row-major:
// [x', y', w] = H · [x, y, 1], then divide by w.

type Pt = number[];
export type Homography = number[];

/** The homography taking quad `from` onto quad `to` (4 corners each, same order), or null if a quad is degenerate. */
export function homography(from: Pt[], to: Pt[]): Homography | null {
  // 8 equations in h0..h7 (h8 = 1): x' (h6 x + h7 y + 1) = h0 x + h1 y + h2, same for y'.
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = solve(rows);
  if (!h) return null;
  const m = [...h, 1];
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  return Math.abs(det) < 1e-12 ? null : m;
}

export function applyHomography(h: Homography, [x, y]: Pt): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Gaussian elimination with partial pivoting on an augmented n×(n+1) matrix. */
function solve(a: number[][]): number[] | null {
  const n = a.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-9) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/** A surface's four corners from its outline, ordered top-left, top-right, bottom-right, bottom-left:
 *  the outline points furthest toward each diagonal direction (robust to extra points and bows). */
export function autoCorners(outline: Pt[]): Pt[] {
  const best = (score: (p: Pt) => number) => outline.reduce((a, p) => (score(p) > score(a) ? p : a));
  return [
    best(([x, y]) => -x - y), // top-left
    best(([x, y]) => x - y), // top-right
    best(([x, y]) => x + y), // bottom-right
    best(([x, y]) => -x + y), // bottom-left
  ].map((p) => [...p]);
}
