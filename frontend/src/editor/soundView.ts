import type { SoundSettings } from "../audio/mic";

/** What the editor's Sound panel shows: the switch state, a 0..100 meter, and a one-line note. */
export function describeSound(settings: SoundSettings, output: { level: number; error: string | null } | null) {
  if (!settings.enabled) return { on: false, meter: 0, note: "Off" };
  if (!output) return { on: true, meter: 0, note: "Open the output window: it does the listening." };
  return { on: true, meter: Math.round(output.level * 100), note: output.error ?? "Listening" };
}
