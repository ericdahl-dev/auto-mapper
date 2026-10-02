import { autoCorners, homography } from "./homography";
import { textKey, type TextStyle } from "./textTexture";

// An effect is one GLSL fragment shader plus the schema of its parameters.
// The editor builds controls from the schema; the output passes params as `u_<name>` uniforms.

export type ParamSchema =
  | { name: string; label: string; type: "color"; default: string }
  | { name: string; label: string; type: "number"; default: number; min?: number; max?: number; step?: number }
  // One of a few named options; the shader gets the option's index as a float.
  | { name: string; label: string; type: "choice"; default: string; options: { value: string; label: string }[] }
  // An uploaded image or video (its URL). The shader gets `sampler2D u_<name>` and its pixel size `vec2 u_<name>Size`.
  | { name: string; label: string; type: "media"; default: string }
  // Text, drawn to a texture (white on black) in the effect's "font" and "align" params if it has them.
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
  /** Fragment shader body. The shared preamble (see compile.ts) is prepended. null = draw nothing. */
  fragment: string | null;
}

export type UniformValue = number | [number, number, number] | number[]; // number[] = mat3, column-major

/** Uniform names the preamble already declares (without the u_ prefix). */
export const RESERVED = ["time", "resolution", "bounds", "scan", "poly", "polyCount", "perimeter", "level", "bass", "mid", "treble", "beat"];

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX = /^#[0-9a-f]{6}$/i;

export function validateEffect(effect: Effect): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of effect.params) {
    if (seen.has(p.name)) problems.push(`duplicate param "${p.name}"`);
    seen.add(p.name);
    if (!IDENT.test(p.name)) problems.push(`param "${p.name}" is not a GLSL identifier`);
    else if (RESERVED.includes(p.name)) problems.push(`param "${p.name}" clashes with a built-in uniform`);
    if (p.type === "number" && (p.default < (p.min ?? -Infinity) || p.default > (p.max ?? Infinity))) {
      problems.push(`param "${p.name}" default ${p.default} is outside ${p.min}..${p.max}`);
    }
    if (p.type === "color" && !HEX.test(p.default)) problems.push(`param "${p.name}" default "${p.default}" is not #rrggbb`);
    if (p.type === "choice" && !p.options.some((o) => o.value === p.default)) {
      problems.push(`param "${p.name}" default "${p.default}" is not one of ${p.options.map((o) => o.value).join(", ")}`);
    }
  }
  return problems;
}

const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** 4 finite [x, y] points. */
export function isQuad(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length === 4 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Uniform values for a surface: declared params only, defaults filled, numbers clamped. Media is bound by the renderer.
 *  `outline` (the surface's polygon) supplies a quad param's corners until the user pins some. */
export function uniformsFor(effect: Effect, params: Record<string, unknown>, outline: number[][] = []): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {};
  for (const p of effect.params) {
    const v = params[p.name];
    if (p.type === "media" || p.type === "text") continue;
    if (p.type === "quad") {
      const h = (isQuad(v) && homography(v, UNIT_SQUARE)) || (outline.length >= 3 && homography(autoCorners(outline), UNIT_SQUARE));
      // Row-major H to GLSL's column-major mat3; an unusable outline gets all zeros (draws the image's corner).
      out[`u_${p.name}`] = h ? [h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8]] : Array(9).fill(0);
      continue;
    }
    if (p.type === "color") {
      out[`u_${p.name}`] = hexToRgb(typeof v === "string" && HEX.test(v) ? v : p.default);
    } else if (p.type === "choice") {
      const i = p.options.findIndex((o) => o.value === v);
      out[`u_${p.name}`] = i >= 0 ? i : p.options.findIndex((o) => o.value === p.default);
    } else {
      const n = typeof v === "number" && Number.isFinite(v) ? v : p.default;
      out[`u_${p.name}`] = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
    }
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
    out[p.name] = textKey({ text, font: choice("font", "sans"), align: choice("align", "center") as TextStyle["align"] });
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
