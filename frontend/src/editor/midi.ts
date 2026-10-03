// MIDI control in the Editor (Web MIDI): knobs and keys bound to settings or actions, learned by
// moving one. DOM-free; editor/main.ts wires it to navigator.requestMIDIAccess and the engine.

import type { ParamSchema } from "../effects/types";
import type { MidiAction, MidiBinding, MidiTarget } from "../shared/messages";

export type { MidiAction, MidiBinding, MidiTarget };

export interface MidiMessage {
  kind: "cc" | "note";
  channel: number;
  number: number;
  value: number; // 0..127: the knob's position, or the key's velocity
}

/** A knob (control change) or a key pressed (note on); null for anything else. */
export function parseMidi(data: ArrayLike<number>): MidiMessage | null {
  if (data.length < 3) return null;
  const [status, number, value] = [data[0], data[1], data[2]];
  const channel = status & 0x0f;
  if ((status & 0xf0) === 0xb0) return { kind: "cc", channel, number, value };
  if ((status & 0xf0) === 0x90 && value > 0) return { kind: "note", channel, number, value };
  return null;
}

/** A knob's position (0..127) as a value for a setting: across a number's range, or one of a choice's
 *  options. null for settings a knob can't set. */
export function settingValue(param: ParamSchema, value: number): number | string | null {
  const t = value / 127;
  if (param.type === "number") {
    const lo = param.min ?? 0, hi = param.max ?? 1;
    const raw = lo + t * (hi - lo);
    const step = param.step ?? 0.01;
    return Math.min(hi, Math.max(lo, Math.round(raw / step) * step));
  }
  if (param.type === "choice") return param.options[Math.min(param.options.length - 1, Math.floor(t * param.options.length))].value;
  return null;
}

export type MidiResult =
  | { learned: MidiBinding }
  | { setting: { surface: number; param: string; value: number } }
  | { action: MidiAction }
  | null;

export class MidiRouter {
  /** The target the next knob or key is bound to (learn mode), or null. */
  armed: MidiTarget | null = null;
  private high = new Map<string, boolean>(); // CCs bound to actions: past halfway last time?

  arm(target: MidiTarget | null): void {
    this.armed = target;
  }

  receive(msg: MidiMessage, bindings: MidiBinding[]): MidiResult {
    if (this.armed) {
      const learned = { kind: msg.kind, channel: msg.channel, number: msg.number, target: this.armed };
      this.armed = null;
      return { learned };
    }
    const b = bindings.find((x) => x.kind === msg.kind && x.channel === msg.channel && x.number === msg.number);
    if (!b) return null;
    if ("param" in b.target) return { setting: { ...b.target, value: msg.value } };
    if (msg.kind === "note") return { action: b.target.action };
    // A knob or fader bound to an action fires when it goes past halfway.
    const key = `${msg.channel}:${msg.number}`;
    const high = msg.value >= 64;
    const was = this.high.get(key) ?? false;
    this.high.set(key, high);
    return high && !was ? { action: b.target.action } : null;
  }
}

export const ACTIONS: { action: MidiAction; label: string }[] = [
  { action: "play", label: "Play" }, { action: "edit", label: "Edit" }, { action: "blackout", label: "Blackout on/off" },
  { action: "next", label: "Next scene" }, { action: "previous", label: "Previous scene" },
];

export interface TargetItem {
  key: string; // stable across redraws and selection changes: "surface:4:zoom", "action:blackout"
  label: string;
  target: MidiTarget;
}

/** A target's key: the same for a menu item and for a binding to that target. */
export function targetKey(t: MidiTarget): string {
  return "action" in t ? `action:${t.action}` : `surface:${t.surface}:${t.param}`;
}

/** What a knob or key can be bound to: the selected surface's number and choice settings, then the actions. */
export function targetMenu(surface: { id: number; name: string; effect: { params: ParamSchema[] } } | null): TargetItem[] {
  const settings: TargetItem[] = (surface?.effect.params ?? [])
    .filter((p) => p.type === "number" || p.type === "choice")
    .map((p) => {
      const target = { surface: surface!.id, param: p.name };
      return { key: targetKey(target), label: `${surface!.name}: ${p.label}`, target };
    });
  const actions = ACTIONS.map(({ action, label }) => ({ key: targetKey({ action }), label, target: { action } }));
  return [...settings, ...actions];
}
