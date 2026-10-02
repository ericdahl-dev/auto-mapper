// Bezier outlines: anchors (corners) joined by edges that are straight or cubic curves.
// Edge i runs from anchors[i] to anchors[i+1] (wrapping); controls[i] holds its two
// control points when it is curved. Everything else (renderer, effects, redetect) uses
// the flattened polygon; the Bezier is kept alongside it only for editing.

type Pt = number[];

export interface Bezier {
  anchors: Pt[];
  controls: Record<number, [Pt, Pt]>;
}

const STEPS = 16; // flattened points per curved edge

export function fromPolygon(polygon: Pt[]): Bezier {
  return { anchors: polygon.map((p) => [...p]), controls: {} };
}

function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * b[k]);
}

/** The outline as a polygon: anchors, plus sampled points along each curved edge. */
export function flatten(b: Bezier, steps = STEPS): Pt[] {
  const n = b.anchors.length;
  const out: Pt[] = [];
  b.anchors.forEach((a, i) => {
    out.push(a);
    const c = b.controls[i];
    if (!c) return;
    const end = b.anchors[(i + 1) % n];
    for (let s = 1; s < steps; s++) out.push(cubic(a, c[0], c[1], end, s / steps));
  });
  return out;
}

/** Makes edge `edge` a curve, with control points a third and two thirds along it. */
export function curveBezierEdge(b: Bezier, edge: number): Bezier {
  const a = b.anchors[edge];
  const e = b.anchors[(edge + 1) % b.anchors.length];
  const at = (t: number) => [Math.round(a[0] + (e[0] - a[0]) * t), Math.round(a[1] + (e[1] - a[1]) * t)];
  return { anchors: b.anchors, controls: { ...b.controls, [edge]: [at(1 / 3), at(2 / 3)] } };
}

export function moveControl(b: Bezier, edge: number, which: 0 | 1, point: Pt): Bezier {
  const c = b.controls[edge];
  if (!c) return b;
  const next: [Pt, Pt] = which === 0 ? [point, c[1]] : [c[0], point];
  return { anchors: b.anchors, controls: { ...b.controls, [edge]: next } };
}

/** Moves an anchor; the control points beside it move with it, keeping the curves' shape. */
export function moveAnchor(b: Bezier, index: number, point: Pt): Bezier {
  const n = b.anchors.length;
  const [dx, dy] = [point[0] - b.anchors[index][0], point[1] - b.anchors[index][1]];
  const shift = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  const controls = { ...b.controls };
  const after = controls[index]; // edge starting at this anchor: its first control is beside it
  if (after) controls[index] = [shift(after[0]), after[1]];
  const prev = (index - 1 + n) % n;
  const before = controls[prev]; // edge ending at this anchor: its second control is beside it
  if (before) controls[prev] = [before[0], shift(before[1])];
  return { anchors: b.anchors.map((p, i) => (i === index ? point : p)), controls };
}

// Edges as a list (start anchor + optional controls) make inserting and removing simple.
type Edge = { anchor: Pt; controls?: [Pt, Pt] };
const toEdges = (b: Bezier): Edge[] => b.anchors.map((anchor, i) => ({ anchor, controls: b.controls[i] }));
function fromEdges(edges: Edge[]): Bezier {
  const controls: Record<number, [Pt, Pt]> = {};
  edges.forEach((e, i) => {
    if (e.controls) controls[i] = e.controls;
  });
  return { anchors: edges.map((e) => e.anchor), controls };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Adds an anchor on the edge nearest `point`. A curved edge is split exactly (de Casteljau),
 *  so the outline keeps its shape. */
export function insertAnchor(b: Bezier, point: Pt): Bezier {
  const n = b.anchors.length;
  let best = { edge: 0, t: 0, d: Infinity };
  b.anchors.forEach((a, i) => {
    const e = b.anchors[(i + 1) % n];
    const c = b.controls[i];
    for (let s = 1; s < 64; s++) {
      const t = s / 64;
      const p = c ? cubic(a, c[0], c[1], e, t) : lerp(a, e, t);
      const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
      if (d < best.d) best = { edge: i, t, d };
    }
  });
  const edges = toEdges(b);
  const { edge, t } = best;
  const a = b.anchors[edge];
  const e = b.anchors[(edge + 1) % n];
  const c = b.controls[edge];
  if (!c) {
    edges.splice(edge + 1, 0, { anchor: lerp(a, e, t) });
    return fromEdges(edges);
  }
  const p01 = lerp(a, c[0], t), p12 = lerp(c[0], c[1], t), p23 = lerp(c[1], e, t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  edges[edge] = { anchor: a, controls: [p01, p012] };
  edges.splice(edge + 1, 0, { anchor: mid, controls: [p123, p23] });
  return fromEdges(edges);
}

/** Removes an anchor; its two edges become one straight edge. Keeps at least a triangle. */
export function removeAnchor(b: Bezier, index: number): Bezier {
  const n = b.anchors.length;
  if (n <= 3) return b;
  const edges = toEdges(b);
  const prev = (index - 1 + n) % n;
  edges[prev] = { anchor: edges[prev].anchor }; // merged edge is straight
  edges.splice(index, 1);
  return fromEdges(edges);
}
