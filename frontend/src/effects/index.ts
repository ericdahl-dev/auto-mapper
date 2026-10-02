import { fill } from "./fill";
import { none } from "./none";
import type { Effect } from "./types";

/** Built-in effects. Adding an effect = adding one file and listing it here. */
export const EFFECTS: Effect[] = [none, fill];

export function effectById(id: string): Effect {
  return EFFECTS.find((e) => e.id === id) ?? none;
}
