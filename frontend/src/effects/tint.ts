import type { Effect } from "./types";

/** Recolors the real object, keeping its texture (wood grain, fabric) visible. */
export const tint: Effect = {
  id: "tint",
  name: "Tint (scan)",
  params: [
    { name: "tintColor", label: "Color", type: "color", default: "#f97316" },
    { name: "strength", label: "Texture", type: "number", default: 0.8, min: 0, max: 1, step: 0.01 },
    { name: "gain", label: "Scan gain", type: "number", default: 1.5, min: 0.5, max: 4, step: 0.05 },
  ],
  fragment: `
void main() {
  float lum = clamp(luminance(scanAt(v_pos)) * u_gain, 0.0, 1.0);
  color = vec4(u_tintColor * mix(1.0, lum, u_strength), 1.0);
}`,
};
