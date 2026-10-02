// Corner-pin handles: the 4 draggable corners of an effect's quad param, shown on the surface.

import { autoCorners } from "../effects/homography";
import { type Effect, isQuad } from "../effects/types";

/** The pin to show for a surface, or null when its effect has no quad param in use. Unpinned shows
 *  the outline's own corners, which is what the shader uses until the user drags one. */
export function pinHandles(effect: Effect, params: Record<string, unknown>, outline: number[][]): { name: string; corners: number[][] } | null {
  const quad = effect.params.find((p) => p.type === "quad");
  if (!quad || quad.type !== "quad") return null;
  const valueOf = (name: string) => {
    const p = effect.params.find((x) => x.name === name);
    return params[name] ?? (p && "default" in p ? p.default : undefined);
  };
  if (quad.when && Object.entries(quad.when).some(([name, value]) => valueOf(name) !== value)) return null;
  const saved = params[quad.name];
  return { name: quad.name, corners: isQuad(saved) ? saved : autoCorners(outline) };
}

export function movePin(corners: number[][], index: number, point: number[]): number[][] {
  return corners.map((c, i) => (i === index ? [...point] : c));
}
