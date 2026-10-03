// The Editor's sidebar sections fold open or shut (#110): everyday ones start open, set-up-once ones
// folded, your choice is remembered, and a section with a problem always opens so nothing is hidden.

const FOLDED_AT_FIRST = new Set(["schedule", "midi", "hardware", "camera", "test-frame"]);

/** Whether a section is open: a problem opens it; otherwise your last choice, else its default. */
export function foldOpen(name: string, saved: Record<string, boolean>, problems: Set<string>): boolean {
  if (problems.has(name)) return true;
  return saved[name] ?? !FOLDED_AT_FIRST.has(name);
}

interface StatusLike {
  hardware: { issues: string[]; projector_missing: string | null };
  output_sound?: { level: number; error: string | null } | null;
  output_sound_output_error?: string | null;
  output_video_sound_blocked?: boolean;
}

/** The sections that have a problem to show, from the engine's status. */
export function problemFolds(status: StatusLike | null): Set<string> {
  const out = new Set<string>();
  if (!status) return out;
  if (status.hardware.issues.length || status.hardware.projector_missing) out.add("hardware");
  if (status.output_video_sound_blocked || status.output_sound_output_error || status.output_sound?.error) out.add("sound");
  return out;
}
