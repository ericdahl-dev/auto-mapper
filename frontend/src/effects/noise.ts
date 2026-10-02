import type { Effect } from "./types";

/** Slowly drifting cloud-like texture between two colours. */
export const noise: Effect = {
  id: "noise",
  name: "Noise flow",
  params: [
    { name: "colorA", label: "Colour", type: "color", default: "#0ea5e9" },
    { name: "colorB", label: "Second colour", type: "color", default: "#a855f7" },
    { name: "scale", label: "Scale", type: "number", default: 4, min: 1, max: 20, step: 0.1 },
    { name: "speed", label: "Speed", type: "number", default: 0.3, min: 0, max: 2, step: 0.01 },
    { name: "contrast", label: "Contrast", type: "number", default: 1.5, min: 0.5, max: 4, step: 0.05 },
    { name: "brightness", label: "Brightness", type: "number", default: 1, min: 0, max: 1, step: 0.01 },
    { name: "react", label: "React to sound", type: "number", default: 0, min: 0, max: 1, step: 0.01 },
  ],
  fragment: `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { sum += amp * valueNoise(p); p *= 2.03; amp *= 0.5; }
  return sum;
}

void main() {
  // Keep the pattern square on non-square surfaces.
  vec2 p = v_uv * vec2(u_bounds.z / u_bounds.w, 1.0) * u_scale;
  float t = u_time * u_speed;
  // Domain warp: noise displaced by noise, drifting over time, reads as flowing.
  vec2 warp = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t)));
  float n = fbm(p + 2.0 * warp + vec2(t, 0.0));
  n = clamp((n - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  // React to sound: dim in silence, swell with the bass, flash on beats.
  float sound = mix(1.0, 0.3 + 0.7 * u_bass + 0.4 * u_beat, u_react);
  color = vec4(mix(u_colorA, u_colorB, n) * u_brightness * sound, 1.0);
}`,
};
