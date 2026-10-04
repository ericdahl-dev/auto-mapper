import type { Effect } from "./types";

/** Glowing lines along the real edges the scan sees: panel grooves, grain, folds. */
export const edgeglow: Effect = {
  id: "edgeglow",
  name: "Edge glow (scan)",
  params: [
    { name: "glowColor", label: "Color", type: "color", default: "#22d3ee" },
    { name: "threshold", label: "Sensitivity", type: "number", default: 0.08, min: 0.01, max: 0.5, step: 0.01 },
    { name: "spread", label: "Line width", type: "number", default: 2, min: 1, max: 8, step: 1, unit: "px" },
    // Ignores stray pixels and fine speckle in the scan (0: every last edge, as it was).
    { name: "smoothing", label: "Smoothing", type: "number", default: 1, min: 0, max: 2, step: 1 },
    { name: "base", label: "Base light", type: "number", default: 0.1, min: 0, max: 1, step: 0.01 },
    { name: "pulse", label: "Pulse", type: "number", default: 0, min: 0, max: 1, step: 0.01 },
  ],
  // The Sobel edges of the scan's brightness at "Line width", precomputed once per scan (#158).
  scanEdges: { spread: "spread", smoothing: "smoothing" },
  fragment: `
void main() {
  float edge = smoothstep(u_threshold, u_threshold * 2.0, scanEdgeAt(v_pos));
  float wave = 1.0 - u_pulse * (0.5 + 0.5 * sin(u_time * 3.0 - v_pos.x * 0.01));
  color = vec4(u_glowColor * edge * wave + u_glowColor * u_base, 1.0);
}`,
};
