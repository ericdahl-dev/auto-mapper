/** The framing check's answer (POST /api/camera/framing, #149). The engine judges it; this words the
 *  good case and turns the outline into SVG points for the preview overlay (0..1 space). */
export interface FramingResult {
  span: number; // share of the camera's view the projection spans
  cut_off: boolean;
  outline: [number, number][];
  advice: string | null; // what to change, or null when it's framed well
}

export function describeFraming(f: FramingResult): { text: string; warn: boolean; points: string } {
  const text = f.advice ?? `Framed well: the projection fills ${Math.round(f.span * 100)}% of the camera's view.`;
  return { text, warn: f.advice !== null, points: f.outline.map(([x, y]) => `${x},${y}`).join(" ") };
}
