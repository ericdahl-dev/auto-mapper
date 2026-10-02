// Gray-code stripes, mirroring engine/scan.py: value at c is bit `bit` of c ^ (c >> 1).

/** One row (or column) of a pattern: 255 where the stripe is lit, 0 where dark. */
export function grayCodeStripe(size: number, bit: number, inverse: boolean): Uint8Array {
  const out = new Uint8Array(size);
  for (let c = 0; c < size; c++) {
    const on = ((c ^ (c >> 1)) >> bit) & 1;
    out[c] = (inverse ? 1 - on : on) * 255;
  }
  return out;
}

/** gl_FragCoord.y counts up from the bottom; the engine counts projector rows from the top. */
export function projectorRow(fragCoordY: number, height: number): number {
  return height - 1 - Math.floor(fragCoordY);
}
