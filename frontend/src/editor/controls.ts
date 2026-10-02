import type { Effect } from "../effects/types";

export type Control =
  | { name: string; label: string; kind: "color"; value: string }
  | { name: string; label: string; kind: "range"; value: number; min: number; max: number; step: number };

/** One editor control per effect param, showing the surface's saved value or the default. */
export function controlsFor(effect: Effect, params: Record<string, unknown>): Control[] {
  return effect.params.map((p) => {
    const saved = params[p.name];
    if (p.type === "color") {
      return { name: p.name, label: p.label, kind: "color", value: typeof saved === "string" ? saved : p.default };
    }
    return {
      name: p.name,
      label: p.label,
      kind: "range",
      value: typeof saved === "number" ? saved : p.default,
      min: p.min ?? 0,
      max: p.max ?? 1,
      step: p.step ?? 0.01,
    };
  });
}

export function parseControlValue(kind: Control["kind"], raw: string): string | number {
  return kind === "color" ? raw : Number(raw);
}
