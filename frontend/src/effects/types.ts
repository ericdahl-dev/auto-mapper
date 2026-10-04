import { settingType } from "./settingTypes";
import { textKey, type TextStyle } from "./textTexture";

// An effect is one GLSL fragment shader plus the schema of its parameters.
// The editor builds controls from the schema; the output passes params as `u_<name>` uniforms.

export type ParamSchema =
  | { name: string; label: string; type: "color"; default: string }
  // `unit` is shown after the value in the editor's readout ("6 px", "90°").
  | { name: string; label: string; type: "number"; default: number; min?: number; max?: number; step?: number; unit?: string }
  // One of a few named options; the shader gets the option's index as a float.
  | { name: string; label: string; type: "choice"; default: string; options: { value: string; label: string }[] }
  // An uploaded image or video (its URL). The shader gets `sampler2D u_<name>` and its pixel size `vec2 u_<name>Size`.
  | { name: string; label: string; type: "media"; default: string }
  // Text, drawn to a texture (white on black) in the font and alignment its effect's textStyle names.
  // The shader gets `sampler2D u_<name>` (use .r as a mask) and its pixel size `vec2 u_<name>Size`.
  | { name: string; label: string; type: "text"; default: string }
  // A corner pin: 4 points (TL, TR, BR, BL) in projector pixels, edited on the surface itself, not in the
  // panel. Unset = the outline's own corners. The shader gets `mat3 u_<name>` taking projector pixels
  // (v_pos) to the pinned quad's 0..1 square (divide xy by z).
  // `when` limits the on-surface handles to some values of other params, e.g. { fit: "corners" }.
  | { name: string; label: string; type: "quad"; when?: Record<string, string> };

export interface Effect {
  id: string;
  name: string;
  params: ParamSchema[];
  /** Effects that can be framed on the surface (drag to pan, scroll to zoom): which settings those are. */
  framing?: { zoom: string; panX: string; panY: string };
  /** For effects that draw text: which settings choose the font and alignment of their text settings. */
  textStyle?: { font: string; align: string };
  /** For effects that play video: what the surface's settings mean for playback (see output/playback.ts). */
  playback?: (params: Record<string, unknown>) => {
    rate: number; start: number; sound: boolean; volume: number;
    channel?: string; // "all", "left", "right", "pan", or "1".."8" (audio/channels.ts)
    pan?: number;
    group?: string; // sync group ("none", "A".."D"): output/syncGroups.ts
  };
  /** Effects that read the scan's edges (scanEdgeAt in the preamble): the settings giving their spread
   *  in pixels and, optionally, their smoothing (a median before the edges: 0 none, 1, 2). The renderer precomputes the edges once per scan and spread (output/scanEdges.ts). */
  scanEdges?: { spread: string; smoothing?: string };
  /** Fragment shader body. The shared preamble (see compile.ts) is prepended. null = draw nothing. */
  fragment: string | null;
}

export { hexToRgb, isQuad } from "./settingTypes";

export type UniformValue = number | [number, number, number] | number[]; // number[] = mat3, column-major

/** Uniform names the preamble already declares (without the u_ prefix). */
export const RESERVED = ["time", "resolution", "bounds", "scan", "scanEdges", "poly", "polyCount", "perimeter", "level", "bass", "mid", "treble", "beat"];

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateEffect(effect: Effect): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of effect.params) {
    if (seen.has(p.name)) problems.push(`duplicate param "${p.name}"`);
    seen.add(p.name);
    if (!IDENT.test(p.name)) problems.push(`param "${p.name}" is not a GLSL identifier`);
    else if (RESERVED.includes(p.name)) problems.push(`param "${p.name}" clashes with a built-in uniform`);
    const issue = settingType(p).validate(p);
    if (issue) problems.push(issue);
  }
  return problems;
}

/** Uniform values for a surface: declared params only, defaults filled, numbers clamped. Media is bound by the renderer.
 *  `outline` (the surface's polygon) supplies a quad param's corners until the user pins some. */
export function uniformsFor(effect: Effect, params: Record<string, unknown>, outline: number[][] = []): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {};
  for (const p of effect.params) {
    const value = settingType(p).uniform(p, params[p.name], outline);
    if (value !== null) out[`u_${p.name}`] = value;
  }
  return out;
}

/** Texture keys for a surface's text params, by param name. */
export function textSources(effect: Effect, params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const choice = (name: string, fallback: string) => {
    const p = effect.params.find((x) => x.name === name);
    const v = params[name];
    return p?.type === "choice" ? (p.options.some((o) => o.value === v) ? (v as string) : p.default) : fallback;
  };
  for (const p of effect.params) {
    if (p.type !== "text") continue;
    const v = params[p.name];
    const text = typeof v === "string" ? v.slice(0, 2000) : p.default;
    const style = effect.textStyle;
    out[p.name] = textKey({
      text,
      font: style ? choice(style.font, "sans") : "sans",
      align: (style ? choice(style.align, "center") : "center") as TextStyle["align"],
    });
  }
  return out;
}

/** The media URLs a surface's params point at, by param name; unset media params are left out. */
export function mediaSources(effect: Effect, params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of effect.params) {
    if (p.type !== "media") continue;
    const v = params[p.name] ?? p.default;
    if (typeof v === "string" && v) out[p.name] = v;
  }
  return out;
}
