// Each effect's settings as plain data for the engine (engine/effect_settings.json), so it can check
// and clamp values sent from outside the Editor. Recorded by settingsRecord.test.ts.

import type { Effect } from "./types";

export type SettingRecord =
  | { type: "number"; default: number; min: number | null; max: number | null }
  | { type: "choice"; default: string; options: string[] }
  | { type: "color" | "media" | "text"; default: string }
  | { type: "quad" };

export function settingsRecord(effects: Effect[]): Record<string, Record<string, SettingRecord>> {
  return Object.fromEntries(effects.map((e) => [e.id, Object.fromEntries(e.params.map((p) => {
    switch (p.type) {
      case "number": return [p.name, { type: p.type, default: p.default, min: p.min ?? null, max: p.max ?? null }];
      case "choice": return [p.name, { type: p.type, default: p.default, options: p.options.map((o) => o.value) }];
      case "quad": return [p.name, { type: p.type }];
      default: return [p.name, { type: p.type, default: p.default }];
    }
  }))]));
}
