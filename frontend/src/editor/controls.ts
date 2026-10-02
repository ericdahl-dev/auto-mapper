import type { Effect } from "../effects/types";

export type Control =
  | { name: string; label: string; kind: "color"; value: string }
  | { name: string; label: string; kind: "range"; value: number; min: number; max: number; step: number }
  | { name: string; label: string; kind: "select"; value: string; options: { value: string; label: string }[] }
  | { name: string; label: string; kind: "media"; value: string };

/** One editor control per effect param, showing the surface's saved value or the default. */
export function controlsFor(effect: Effect, params: Record<string, unknown>): Control[] {
  return effect.params.flatMap((p): Control[] => {
    const saved = params[p.name];
    if (p.type === "quad") return []; // edited with handles on the surface, not in the panel
    if (p.type === "color") {
      return [{ name: p.name, label: p.label, kind: "color", value: typeof saved === "string" ? saved : p.default }];
    }
    if (p.type === "choice") {
      const value = p.options.some((o) => o.value === saved) ? (saved as string) : p.default;
      return [{ name: p.name, label: p.label, kind: "select", value, options: p.options }];
    }
    if (p.type === "media") {
      return [{ name: p.name, label: p.label, kind: "media", value: typeof saved === "string" ? saved : p.default }];
    }
    return [{
      name: p.name,
      label: p.label,
      kind: "range",
      value: typeof saved === "number" ? saved : p.default,
      min: p.min ?? 0,
      max: p.max ?? 1,
      step: p.step ?? 0.01,
    }];
  });
}

export function parseControlValue(kind: Control["kind"], raw: string): string | number {
  return kind === "range" ? Number(raw) : raw;
}

/** What the editor shows for a media param: the stored file's name. */
export function mediaLabel(src: string): string {
  return src ? decodeURIComponent(src.split("/").pop() ?? src) : "No file chosen";
}
