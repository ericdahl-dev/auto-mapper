// Geometry shared by the output (where the shader's u_bounds comes from) and the editor (framing):
// both must agree, since pan is a fraction of the surface's bounding box.

/** [x, y, width, height] of an outline in projector pixels; width and height are at least 1. */
export function boundingBox(outline: number[][]): [number, number, number, number] {
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(1, Math.max(...xs) - x0), Math.max(1, Math.max(...ys) - y0)];
}

/** The outline moved outward (positive) or inward (negative) by `d` projector pixels: each corner
 *  moves along its bisector (mitered, limited at sharp corners). An inset is limited to a quarter of
 *  the surface's smaller side, so small surfaces never collapse. Works for either winding. */
export function offsetPolygon(outline: number[][], d: number): number[][] {
  if (d === 0 || outline.length < 3) return outline.map((p) => [...p]);
  const [, , w, h] = boundingBox(outline);
  const dist = Math.max(d, -Math.min(w, h) / 4);
  const signed = outline.reduce((s, [x, y], i) => {
    const [nx, ny] = outline[(i + 1) % outline.length];
    return s + x * ny - nx * y;
  }, 0);
  const flip = signed >= 0 ? 1 : -1;
  const n = outline.length;
  // Outward unit normal of edge i (from point i to point i+1).
  const normals = outline.map(([x, y], i) => {
    const [nx, ny] = outline[(i + 1) % n];
    const len = Math.hypot(nx - x, ny - y) || 1;
    return [(flip * (ny - y)) / len, (flip * -(nx - x)) / len];
  });
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return outline.map(([x, y], i) => {
    const a = normals[(i - 1 + n) % n];
    const b = normals[i];
    const mx = a[0] + b[0], my = a[1] + b[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) return [round(x + a[0] * dist), round(y + a[1] * dist)]; // a hairpin: just move along one
    const [ux, uy] = [mx / ml, my / ml];
    const cos = ux * a[0] + uy * a[1];
    const len = Math.min(Math.abs(dist / Math.max(cos, 1e-3)), 3 * Math.abs(dist)) * Math.sign(dist); // miter limit
    return [round(x + ux * len), round(y + uy * len)];
  });
}
