// Geometry shared by the output (where the shader's u_bounds comes from) and the editor (framing):
// both must agree, since pan is a fraction of the surface's bounding box.

/** [x, y, width, height] of an outline in projector pixels; width and height are at least 1. */
export function boundingBox(outline: number[][]): [number, number, number, number] {
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(1, Math.max(...xs) - x0), Math.max(1, Math.max(...ys) - y0)];
}
