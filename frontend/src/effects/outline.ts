import type { Effect } from "./types";

/** A glowing line around the surface's edge, optionally chasing round it (the classic look). */
export const outline: Effect = {
  id: "outline",
  name: "Outline trace",
  params: [
    { name: "lineColor", label: "Colour", type: "color", default: "#ffffff" },
    { name: "width", label: "Line width (px)", type: "number", default: 6, min: 1, max: 40, step: 1 },
    { name: "glow", label: "Glow", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
    { name: "chase", label: "Chase", type: "number", default: 1, min: 0, max: 1, step: 0.01 },
    { name: "speed", label: "Speed (laps/s)", type: "number", default: 0.25, min: 0, max: 2, step: 0.01 },
    { name: "segments", label: "Segments", type: "number", default: 1, min: 1, max: 8, step: 1 },
    { name: "react", label: "React to sound", type: "number", default: 0, min: 0, max: 1, step: 0.01 },
  ],
  fragment: `
void main() {
  float along;
  float d = polyEdge(v_pos, along);
  // React to sound: the line thickens on beats and glows with loudness.
  float width = u_width * (1.0 + 1.5 * u_react * u_beat);
  float core = 1.0 - smoothstep(width - 1.0, width, d);
  float halo = (u_glow + u_react * u_level) * exp(-max(d - width, 0.0) / (width * 2.0));
  // Position round the outline (0..1 per segment), moving with time. A bright head, fading tail.
  float phase = fract(along / max(u_perimeter, 1.0) * floor(u_segments) - u_time * u_speed);
  float trail = pow(phase, 3.0);
  float lit = (core + halo) * mix(1.0, trail, u_chase);
  color = vec4(u_lineColor * clamp(lit, 0.0, 1.0), 1.0);
}`,
};
