import type { Effect } from "./types";

/** Solid color, or a linear gradient when the two colors differ. */
export const fill: Effect = {
  id: "fill",
  name: "Fill",
  params: [
    { name: "colorA", label: "Color", type: "color", default: "#2563eb" },
    { name: "colorB", label: "Gradient to", type: "color", default: "#2563eb" },
    { name: "angle", label: "Gradient angle", type: "number", default: 90, min: 0, max: 360, step: 1, unit: "°" },
    { name: "brightness", label: "Brightness", type: "number", default: 1, min: 0, max: 1, step: 0.01 },
    { name: "react", label: "React to sound", type: "number", default: 0, min: 0, max: 1, step: 0.01 },
  ],
  fragment: `
void main() {
  float a = radians(u_angle);
  vec2 dir = vec2(cos(a), sin(a));
  // Project the surface-local position onto the gradient direction, 0..1 across the surface.
  float t = clamp(dot(v_uv - 0.5, dir) + 0.5, 0.0, 1.0);
  // React to sound: dim in silence, swell with loudness, flash on beats.
  float sound = mix(1.0, 0.25 + 0.75 * u_level + 0.5 * u_beat, u_react);
  color = vec4(mix(u_colorA, u_colorB, t) * u_brightness * sound, 1.0);
}`,
};
