// Each surface on the scan is tinted by its effect (#122), so dark surfaces, video ones and ones
// sharing an effect tell apart without clicking each.
import { hexToRgb } from "../effects/settingTypes";
import type { Effect } from "../effects/types";

/** None (dark): a hatch pattern (defined in index.html) instead of a tint. */
export const NO_EFFECT_FILL = "url(#no-effect-hatch)";
const ALPHA = 0.35; // the scan still shows through

const HEX = /^#[0-9a-f]{6}$/i;
const HUES: Record<string, number> = { media: 280, posterize: 45 }; // violet, amber

/** The fill for a surface's outline on the scan, from its effect and settings. */
export function surfaceFill(effect: Effect, params: Record<string, unknown>): string {
  if (effect.fragment === null) return NO_EFFECT_FILL;
  // The main color: the one labeled just "Color" (Fill, Outline trace, Noise flow, Tint, Edge glow, Text).
  const main = effect.params.find((p) => p.type === "color" && p.label === "Color");
  if (main?.type === "color") {
    const saved = params[main.name];
    const [r, g, b] = hexToRgb(typeof saved === "string" && HEX.test(saved) ? saved : main.default).map((c) => Math.round(c * 255));
    return `rgba(${r}, ${g}, ${b}, ${ALPHA})`;
  }
  // Others: a hue of their own, the same every time; a new effect gets one from its id.
  let hue = HUES[effect.id];
  if (hue === undefined) {
    hue = 0;
    for (const ch of effect.id) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  }
  return `hsla(${hue}, 70%, 55%, ${ALPHA})`;
}
