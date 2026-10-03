import type { SoundSettings } from "../audio/mic";

/** What the editor's Sound panel shows: the switch state, a 0..100 meter, and a one-line note. */
export function describeSound(settings: SoundSettings, output: { level: number; error: string | null } | null) {
  if (!settings.enabled) return { on: false, meter: 0, note: "Off" };
  if (!output) return { on: true, meter: 0, note: "Open the output window: it does the listening." };
  return { on: true, meter: Math.round(output.level * 100), note: output.error ?? "Listening" };
}

/** The sound output's channel count, with a warning when a surface's Sound channel is beyond it
 *  (multichannel interfaces can report 2 until set up in macOS Audio MIDI Setup). */
export function channelNote(channels: number | null, chosen: string[]): string {
  if (!channels) return "";
  const beyond = chosen.map(Number).filter((n) => Number.isInteger(n) && n > channels);
  if (!beyond.length) return `${channels} channels`;
  return `${channels} channels, but a surface uses channel ${Math.max(...beyond)}. ` +
    "Set up the interface's channels in Audio MIDI Setup, or pick another Sound output.";
}

/** The settings of an effect that follow sound (React to sound), when sound is off and so they do nothing. */
export function soundOffSettings(effect: { params: { name: string }[] }, soundOn: boolean): string[] {
  return soundOn ? [] : effect.params.filter((p) => p.name === "react").map((p) => p.name);
}
