// An effect is one GLSL fragment shader plus the schema of its parameters.
// The editor builds controls from the schema; the output passes params as `u_<name>` uniforms.

export type ParamSchema =
  | { name: string; label: string; type: "color"; default: string }
  | { name: string; label: string; type: "number"; default: number; min?: number; max?: number; step?: number }
  // One of a few named options; the shader gets the option's index as a float.
  | { name: string; label: string; type: "choice"; default: string; options: { value: string; label: string }[] }
  // An uploaded image or video (its URL). The shader gets `sampler2D u_<name>` and its pixel size `vec2 u_<name>Size`.
  | { name: string; label: string; type: "media"; default: string };

export interface Effect {
  id: string;
  name: string;
  params: ParamSchema[];
  /** Fragment shader body. The shared preamble (see compile.ts) is prepended. null = draw nothing. */
  fragment: string | null;
}

export type UniformValue = number | [number, number, number];

/** Uniform names the preamble already declares (without the u_ prefix). */
export const RESERVED = ["time", "resolution", "bounds", "scan", "poly", "polyCount", "perimeter"];

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

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Uniform values for a surface: declared params only, defaults filled, numbers clamped. Media is bound by the renderer. */
export function uniformsFor(effect: Effect, params: Record<string, unknown>): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {};
  for (const p of effect.params) {
    const v = params[p.name];
    if (p.type === "media") continue;
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

/** The media URLs a surface's params point at, by param name; unset media params are left out. */
export function mediaSources(effect: Effect, params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of effect.params) {
    const v = params[p.name] ?? p.default;
    if (p.type === "media" && typeof v === "string" && v) out[p.name] = v;
  }
  return out;
}
