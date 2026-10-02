import type { Effect } from "./types";

/** Glowing lines along the real edges the scan sees: panel grooves, grain, folds. */
export const edgeglow: Effect = {
  id: "edgeglow",
  name: "Edge glow (scan)",
  params: [
    { name: "glowColor", label: "Colour", type: "color", default: "#22d3ee" },
    { name: "threshold", label: "Sensitivity", type: "number", default: 0.08, min: 0.01, max: 0.5, step: 0.01 },
    { name: "spread", label: "Line width (px)", type: "number", default: 2, min: 1, max: 8, step: 1 },
    { name: "base", label: "Base light", type: "number", default: 0.1, min: 0, max: 1, step: 0.01 },
    { name: "pulse", label: "Pulse", type: "number", default: 0, min: 0, max: 1, step: 0.01 },
  ],
  fragment: `
void main() {
  float d = u_spread;
  // Sobel on the scan's brightness.
  float tl = luminance(scanAt(v_pos + vec2(-d, -d))), t = luminance(scanAt(v_pos + vec2(0, -d)));
  float tr = luminance(scanAt(v_pos + vec2(d, -d))), l = luminance(scanAt(v_pos + vec2(-d, 0)));
  float r = luminance(scanAt(v_pos + vec2(d, 0))), bl = luminance(scanAt(v_pos + vec2(-d, d)));
  float b = luminance(scanAt(v_pos + vec2(0, d))), br = luminance(scanAt(v_pos + vec2(d, d)));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  float edge = smoothstep(u_threshold, u_threshold * 2.0, length(vec2(gx, gy)));
  float wave = 1.0 - u_pulse * (0.5 + 0.5 * sin(u_time * 3.0 - v_pos.x * 0.01));
  color = vec4(u_glowColor * edge * wave + u_glowColor * u_base, 1.0);
}`,
};
