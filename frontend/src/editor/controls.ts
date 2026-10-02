import { type Control, settingType } from "../effects/settingTypes";
import type { Effect } from "../effects/types";

export type { Control } from "../effects/settingTypes";

/** One editor control per effect setting shown in the panel, with the surface's saved value or the default. */
export function controlsFor(effect: Effect, params: Record<string, unknown>): Control[] {
  return effect.params.flatMap((p) => {
    const control = settingType(p).control(p, params[p.name]);
    return control ? [control] : [];
  });
}

export function parseControlValue(kind: Control["kind"], raw: string): string | number {
  return kind === "range" ? Number(raw) : raw;
}

/** What the editor shows for a media param: the stored file's name. */
export function mediaLabel(src: string): string {
  return src ? decodeURIComponent(src.split("/").pop() ?? src) : "No file chosen";
}
