import { edgeglow } from "./edgeglow";
import { fill } from "./fill";
import { noise } from "./noise";
import { none } from "./none";
import { outline } from "./outline";
import { posterize } from "./posterize";
import { tint } from "./tint";
import type { Effect } from "./types";

/** Built-in effects. Adding an effect = adding one file and listing it here. */
export const EFFECTS: Effect[] = [none, fill, outline, noise, tint, edgeglow, posterize];

export function effectById(id: string): Effect {
  return EFFECTS.find((e) => e.id === id) ?? none;
}
