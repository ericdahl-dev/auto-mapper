import type { Effect } from "./types";

/** An uploaded image or video, mapped to the surface's bounding box and clipped to its outline. */
export const media: Effect = {
  id: "media",
  name: "Image / video",
  params: [
    { name: "src", label: "Image or video", type: "media", default: "" },
    { name: "fit", label: "Fit", type: "choice", default: "cover", options: [
      { value: "cover", label: "Cover" },
      { value: "stretch", label: "Stretch" },
    ] },
  ],
  fragment: `
void main() {
  vec2 uv = v_uv;
  if (u_fit < 0.5 && u_srcSize.x > 0.0 && u_srcSize.y > 0.0) {
    // Cover: scale to fill the bounding box keeping the media's aspect, crop the overflow evenly.
    float surface = u_bounds.z / u_bounds.w;
    float image = u_srcSize.x / u_srcSize.y;
    if (image > surface) uv.x = 0.5 + (uv.x - 0.5) * surface / image;
    else uv.y = 0.5 + (uv.y - 0.5) * image / surface;
  }
  color = vec4(texture(u_src, uv).rgb, 1.0);
}`,
};
