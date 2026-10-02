import type { Effect } from "./types";

/** An uploaded image or video, clipped to the surface's outline. Cover and Stretch map it to the
 *  surface's bounding box; Map to corners warps it onto the surface's four corners (a corner pin),
 *  so it lies flat on a surface seen at an angle. */
export const media: Effect = {
  id: "media",
  name: "Image / video",
  params: [
    { name: "src", label: "Image or video", type: "media", default: "" },
    { name: "fit", label: "Fit", type: "choice", default: "cover", options: [
      { value: "cover", label: "Cover" },
      { value: "stretch", label: "Stretch" },
      { value: "corners", label: "Map to corners" },
    ] },
    { name: "corners", label: "Corners", type: "quad", when: { fit: "corners" } },
  ],
  fragment: `
void main() {
  vec2 uv = v_uv;
  if (u_fit > 1.5) {
    // Map to corners: projector pixel -> the pinned quad's 0..1 square. Outside the quad stays dark.
    vec3 h = u_corners * vec3(v_pos, 1.0);
    uv = h.xy / h.z;
    if (h.z <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      color = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  } else if (u_fit < 0.5 && u_srcSize.x > 0.0 && u_srcSize.y > 0.0) {
    // Cover: scale to fill the bounding box keeping the media's aspect, crop the overflow evenly.
    float surface = u_bounds.z / u_bounds.w;
    float image = u_srcSize.x / u_srcSize.y;
    if (image > surface) uv.x = 0.5 + (uv.x - 0.5) * surface / image;
    else uv.y = 0.5 + (uv.y - 0.5) * image / surface;
  }
  color = vec4(texture(u_src, uv).rgb, 1.0);
}`,
};
