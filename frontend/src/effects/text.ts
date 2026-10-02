import type { Effect } from "./types";

/** Text drawn on a surface: fitted inside its bounding box (keeping the text's shape), or
 *  corner-pinned onto its four corners. Optional scrolling or pulsing. */
export const text: Effect = {
  id: "text",
  name: "Text",
  params: [
    { name: "text", label: "Text", type: "text", default: "Hello" },
    { name: "color", label: "Color", type: "color", default: "#ffffff" },
    { name: "background", label: "Background", type: "color", default: "#000000" },
    { name: "font", label: "Font", type: "choice", default: "sans", options: [
      { value: "sans", label: "Sans" },
      { value: "serif", label: "Serif" },
      { value: "mono", label: "Mono" },
    ] },
    { name: "align", label: "Align", type: "choice", default: "center", options: [
      { value: "left", label: "Left" },
      { value: "center", label: "Center" },
      { value: "right", label: "Right" },
    ] },
    { name: "fit", label: "Fit", type: "choice", default: "fit", options: [
      { value: "fit", label: "Fit inside" },
      { value: "corners", label: "Map to corners" },
    ] },
    { name: "corners", label: "Corners", type: "quad", when: { fit: "corners" } },
    { name: "motion", label: "Motion", type: "choice", default: "none", options: [
      { value: "none", label: "None" },
      { value: "scroll", label: "Scroll" },
      { value: "pulse", label: "Pulse" },
    ] },
    { name: "speed", label: "Speed", type: "number", default: 0.2, min: 0, max: 2, step: 0.01 },
    { name: "react", label: "React to sound", type: "number", default: 0, min: 0, max: 1, step: 0.01 },
  ],
  textStyle: { font: "font", align: "align" },
  fragment: `
void main() {
  vec2 size = max(u_textSize, vec2(1.0));
  vec2 uv;
  if (u_fit > 0.5) {
    // Map to corners: the text's box stretched onto the pinned quad.
    vec3 h = u_corners * vec3(v_pos, 1.0);
    uv = h.z > 0.0 ? h.xy / h.z : vec2(-1.0);
  } else {
    // Fit inside: the whole text in the bounding box, keeping its shape, centered.
    uv = v_uv;
    float surface = u_bounds.z / u_bounds.w;
    float image = size.x / size.y;
    if (image > surface) uv.y = 0.5 + (uv.y - 0.5) * image / surface;
    else uv.x = 0.5 + (uv.x - 0.5) * surface / image;
  }
  float glow = 1.0;
  if (u_motion > 0.5 && u_motion < 1.5) uv.x = fract(uv.x + u_time * u_speed); // scroll, wrapping round
  else if (u_motion > 1.5) glow = 0.6 + 0.4 * sin(u_time * u_speed * 6.2831);  // pulse
  glow *= mix(1.0, 0.4 + 0.6 * u_level + 0.5 * u_beat, u_react);
  float ink = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.0 : texture(u_text, uv).r;
  color = vec4(mix(u_background, u_color * min(glow, 1.5), ink), 1.0);
}`,
};
