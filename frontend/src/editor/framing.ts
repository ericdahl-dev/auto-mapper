// Framing media on the surface itself: drag to pan, scroll to zoom. Values match the media
// effect's zoom/panX/panY params (pan in fractions of the surface's bounding box).

import { media } from "../effects/media";
import { boundingBox } from "../shared/geometry";
import type { Effect } from "../effects/types";

const range = (name: string): [number, number] => {
  const p = media.params.find((x) => x.name === name);
  return p?.type === "number" ? [p.min ?? -Infinity, p.max ?? Infinity] : [-Infinity, Infinity];
};
const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;

export function canFrame(effect: Effect): boolean {
  return ["zoom", "panX", "panY"].every((n) => effect.params.some((p) => p.name === n && p.type === "number"));
}

/** New pan after dragging the pointer by `delta` projector pixels. */
export function panAfterDrag(pan: { panX: number; panY: number }, [dx, dy]: number[], outline: number[][]) {
  const [, , w, h] = boundingBox(outline); // the same box the shader's u_bounds uses
  return {
    panX: round(clamp(pan.panX + dx / w, range("panX"))),
    panY: round(clamp(pan.panY + dy / h, range("panY"))),
  };
}

/** New zoom after a wheel event (negative deltaY = scroll up = zoom in). */
export function zoomAfterWheel(zoom: number, deltaY: number): number {
  return round(clamp(zoom * Math.exp(-deltaY * 0.002), range("zoom")));
}
