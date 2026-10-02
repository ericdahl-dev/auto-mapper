import type { Effect } from "./types";

/** Flattens the real surface into a few bands of colour, like a screen print. */
export const posterize: Effect = {
  id: "posterize",
  name: "Posterize (scan)",
  params: [
    { name: "levels", label: "Bands", type: "number", default: 4, min: 2, max: 8, step: 1 },
    { name: "colorA", label: "Dark colour", type: "color", default: "#1e1b4b" },
    { name: "colorB", label: "Light colour", type: "color", default: "#fde047" },
    { name: "gain", label: "Scan gain", type: "number", default: 1.5, min: 0.5, max: 4, step: 0.05 },
  ],
  fragment: `
void main() {
  float n = floor(u_levels);
  float lum = clamp(luminance(scanAt(v_pos)) * u_gain, 0.0, 1.0);
  float band = min(floor(lum * n), n - 1.0) / (n - 1.0);
  color = vec4(mix(u_colorA, u_colorB, band), 1.0);
}`,
};
