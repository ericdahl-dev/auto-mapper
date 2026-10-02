// Everything about each kind of effect setting in one place: how the shader declares it, the value it
// gets, the editor control, validation, and whether the renderer binds it as a texture. Adding a
// setting type = adding an entry here (and its case in ParamSchema).

import { autoCorners, homography } from "./homography";
import type { ParamSchema, UniformValue } from "./types";

/** An editor control for one setting, showing the surface's saved value or the default. */
export type Control =
  | { name: string; label: string; kind: "color"; value: string }
  | { name: string; label: string; kind: "range"; value: number; min: number; max: number; step: number }
  | { name: string; label: string; kind: "select"; value: string; options: { value: string; label: string }[] }
  | { name: string; label: string; kind: "media"; value: string }
  | { name: string; label: string; kind: "text"; value: string };

type Kind = ParamSchema["type"];
type ParamOf<K extends Kind> = Extract<ParamSchema, { type: K }>;

interface SettingType<K extends Kind> {
  /** GLSL uniform declarations for this setting. */
  glsl(p: ParamOf<K>): string;
  /** The uniform value for a saved value (defaults filled, clamped); null when bound as a texture or not a uniform. */
  uniform(p: ParamOf<K>, saved: unknown, outline: number[][]): UniformValue | null;
  /** The editor panel control, or null for settings edited elsewhere (e.g. corner pins on the surface). */
  control(p: ParamOf<K>, saved: unknown): Control | null;
  /** A problem with the schema entry, or null. */
  validate(p: ParamOf<K>): string | null;
  /** Bound by the renderer as `sampler2D u_<name>` plus `vec2 u_<name>Size`. */
  texture: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;
const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const sampler = (p: { name: string }) => `uniform sampler2D u_${p.name};\nuniform vec2 u_${p.name}Size;`;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 4 finite [x, y] points. */
export function isQuad(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length === 4 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
}

export const SETTING_TYPES: { [K in Kind]: SettingType<K> } = {
  color: {
    glsl: (p) => `uniform vec3 u_${p.name};`,
    uniform: (p, v) => hexToRgb(typeof v === "string" && HEX.test(v) ? v : p.default),
    control: (p, v) => ({ name: p.name, label: p.label, kind: "color", value: str(v, p.default) }),
    validate: (p) => (HEX.test(p.default) ? null : `param "${p.name}" default "${p.default}" is not #rrggbb`),
    texture: false,
  },
  number: {
    glsl: (p) => `uniform float u_${p.name};`,
    uniform: (p, v) => {
      const n = typeof v === "number" && Number.isFinite(v) ? v : p.default;
      return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
    },
    control: (p, v) => ({
      name: p.name, label: p.label, kind: "range", value: typeof v === "number" ? v : p.default,
      min: p.min ?? 0, max: p.max ?? 1, step: p.step ?? 0.01,
    }),
    validate: (p) =>
      p.default < (p.min ?? -Infinity) || p.default > (p.max ?? Infinity)
        ? `param "${p.name}" default ${p.default} is outside ${p.min}..${p.max}`
        : null,
    texture: false,
  },
  // One of a few named options; the shader gets the option's index as a float.
  choice: {
    glsl: (p) => `uniform float u_${p.name};`,
    uniform: (p, v) => {
      const i = p.options.findIndex((o) => o.value === v);
      return i >= 0 ? i : p.options.findIndex((o) => o.value === p.default);
    },
    control: (p, v) => ({
      name: p.name, label: p.label, kind: "select", options: p.options,
      value: p.options.some((o) => o.value === v) ? (v as string) : p.default,
    }),
    validate: (p) =>
      p.options.some((o) => o.value === p.default)
        ? null
        : `param "${p.name}" default "${p.default}" is not one of ${p.options.map((o) => o.value).join(", ")}`,
    texture: false,
  },
  media: {
    glsl: sampler,
    uniform: () => null,
    control: (p, v) => ({ name: p.name, label: p.label, kind: "media", value: str(v, p.default) }),
    validate: () => null,
    texture: true,
  },
  text: {
    glsl: sampler,
    uniform: () => null,
    control: (p, v) => ({ name: p.name, label: p.label, kind: "text", value: str(v, p.default) }),
    validate: () => null,
    texture: true,
  },
  // A corner pin: `mat3 u_<name>` from projector pixels to the pinned quad's 0..1 square; the outline's
  // own corners until the user pins some. Edited with handles on the surface, not in the panel.
  quad: {
    glsl: (p) => `uniform mat3 u_${p.name};`,
    uniform: (_p, v, outline) => {
      const h = (isQuad(v) && homography(v, UNIT_SQUARE)) || (outline.length >= 3 && homography(autoCorners(outline), UNIT_SQUARE));
      // Row-major H to GLSL's column-major mat3; an unusable outline gets all zeros (draws the image's corner).
      return h ? [h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8]] : Array(9).fill(0);
    },
    control: () => null,
    validate: () => null,
    texture: false,
  },
};

/** The entry for a setting's type. */
export function settingType(p: ParamSchema): SettingType<Kind> {
  return SETTING_TYPES[p.type] as unknown as SettingType<Kind>;
}
