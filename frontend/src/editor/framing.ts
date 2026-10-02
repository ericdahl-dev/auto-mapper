// Framing media on the surface itself: drag to pan, scroll to zoom. Effects that support it declare
// which of their settings are zoom and pan (Effect.framing); ranges come from those settings.
// Pan is in fractions of the surface's bounding box.

import type { Effect, ParamSchema } from "../effects/types";
import { boundingBox } from "../shared/geometry";

type Framing = NonNullable<Effect["framing"]>;

/** The effect's zoom and pan settings, or null if it can't be framed on the surface. */
export function framingOf(effect: Effect): Framing | null {
  return effect.framing ?? null;
}

const range = (effect: Effect, name: string): [number, number] => {
  const p = effect.params.find((x: ParamSchema) => x.name === name);
  return p?.type === "number" ? [p.min ?? -Infinity, p.max ?? Infinity] : [-Infinity, Infinity];
};
const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** New pan (keyed panX/panY) after dragging the pointer by `delta` projector pixels. */
export function panAfterDrag(effect: Effect, pan: { panX: number; panY: number }, [dx, dy]: number[], outline: number[][]) {
  const f = framingOf(effect)!;
  const [, , w, h] = boundingBox(outline); // the same box the shader's u_bounds uses
  return {
    panX: round(clamp(pan.panX + dx / w, range(effect, f.panX))),
    panY: round(clamp(pan.panY + dy / h, range(effect, f.panY))),
  };
}

/** New zoom after a wheel event (negative deltaY = scroll up = zoom in). */
export function zoomAfterWheel(effect: Effect, zoom: number, deltaY: number): number {
  return round(clamp(zoom * Math.exp(-deltaY * 0.002), range(effect, framingOf(effect)!.zoom)));
}
