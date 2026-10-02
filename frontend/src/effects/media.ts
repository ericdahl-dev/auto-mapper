import type { Effect } from "./types";

/** An uploaded image or video, clipped to the surface's outline. Cover, Stretch, Contain, Original size
 *  and Tile place it in the surface's bounding box; Map to corners warps it onto the surface's four
 *  corners (a corner pin), so it lies flat on a surface seen at an angle. Zoom, pan and rotate then
 *  frame it; anything outside the image shows the background colour. */
export const media: Effect = {
  id: "media",
  name: "Image / video",
  params: [
    { name: "src", label: "Image or video", type: "media", default: "" },
    // Option order is the shader's u_fit index: append new fits, never reorder (saved projects store the value).
    { name: "fit", label: "Fit", type: "choice", default: "cover", options: [
      { value: "cover", label: "Cover" },
      { value: "stretch", label: "Stretch" },
      { value: "corners", label: "Map to corners" },
      { value: "contain", label: "Contain" },
      { value: "original", label: "Original size" },
      { value: "tile", label: "Tile" },
    ] },
    { name: "corners", label: "Corners", type: "quad", when: { fit: "corners" } },
    { name: "zoom", label: "Zoom", type: "number", default: 1, min: 0.1, max: 10, step: 0.01 },
    { name: "panX", label: "Pan left/right", type: "number", default: 0, min: -1, max: 1, step: 0.005 },
    { name: "panY", label: "Pan up/down", type: "number", default: 0, min: -1, max: 1, step: 0.005 },
    { name: "rotate", label: "Rotate (°)", type: "number", default: 0, min: -180, max: 180, step: 1 },
    { name: "flip", label: "Flip", type: "choice", default: "none", options: [
      { value: "none", label: "None" },
      { value: "horizontal", label: "Horizontal" },
      { value: "vertical", label: "Vertical" },
      { value: "both", label: "Both" },
    ] },
    { name: "background", label: "Background", type: "color", default: "#000000" },
  ],
  fragment: `
// Zoom, pan and rotate a point p centred on 0 (-0.5..0.5 across the space), in a space of the given
// width/height, so rotation doesn't shear. Returns where in that space to sample.
vec2 frame(vec2 p, float aspect) {
  p -= vec2(u_panX, u_panY);
  vec2 q = p * vec2(aspect, 1.0);
  float a = radians(u_rotate);
  q = mat2(cos(a), sin(a), -sin(a), cos(a)) * q / u_zoom;
  return q / vec2(aspect, 1.0);
}

void main() {
  vec2 size = max(u_srcSize, vec2(1.0));
  float image = size.x / size.y;
  vec2 uv;
  if (u_fit > 1.5 && u_fit < 2.5) {
    // Map to corners: projector pixel -> the pinned quad's 0..1 square, then frame in the image's space.
    vec3 h = u_corners * vec3(v_pos, 1.0);
    if (h.z <= 0.0) { color = vec4(u_background, 1.0); return; }
    uv = frame(h.xy / h.z - 0.5, image) + 0.5;
  } else {
    // Frame in the surface's bounding box, then fit the image to it.
    uv = frame(v_uv - 0.5, u_bounds.z / u_bounds.w) + 0.5;
    float surface = u_bounds.z / u_bounds.w;
    if (u_fit < 0.5) {
      // Cover: fill the box keeping the image's aspect, cropping the overflow evenly.
      if (image > surface) uv.x = 0.5 + (uv.x - 0.5) * surface / image;
      else uv.y = 0.5 + (uv.y - 0.5) * image / surface;
    } else if (u_fit < 3.5 && u_fit > 2.5) {
      // Contain: the whole image inside the box, letterboxed.
      if (image > surface) uv.y = 0.5 + (uv.y - 0.5) * image / surface;
      else uv.x = 0.5 + (uv.x - 0.5) * surface / image;
    } else if (u_fit > 3.5 && u_fit < 4.5) {
      // Original size: one image pixel per projector pixel, centred on the box.
      uv = ((uv - 0.5) * u_bounds.zw + size * 0.5) / size;
    } else if (u_fit > 4.5) {
      // Tile: original-size copies repeating from the box's top-left.
      uv = fract(uv * u_bounds.zw / size);
    }
  }
  if (u_flip > 0.5 && u_flip < 1.5 || u_flip > 2.5) uv.x = 1.0 - uv.x;
  if (u_flip > 1.5) uv.y = 1.0 - uv.y;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    color = vec4(u_background, 1.0);
    return;
  }
  color = vec4(texture(u_src, uv).rgb, 1.0);
}`,
};
