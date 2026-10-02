import { fill } from "./fill";
import { noise } from "./noise";
import { none } from "./none";
import { outline } from "./outline";
import type { Effect } from "./types";

/** Built-in effects. Adding an effect = adding one file and listing it here. */
export const EFFECTS: Effect[] = [none, fill, outline, noise];

export function effectById(id: string): Effect {
  return EFFECTS.find((e) => e.id === id) ?? none;
}
