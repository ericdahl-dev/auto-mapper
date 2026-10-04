// Message shapes shared with the engine. Mirrors engine/messages.py and engine/hub.py.

export type TestFrameKind = "white" | "black" | "grid";
export const TEST_FRAME_KINDS: readonly TestFrameKind[] = ["white", "black", "grid"];

export interface Projector {
  name: string;
  key: string;
  width: number;
  height: number;
}

export interface DisplayInfo extends Projector {
  main: boolean;
}

export type HardwareIssue = "no_projector" | "no_camera";

export interface CameraInfo {
  name: string;
  unique_id: string;
  device_type: "builtin" | "external" | "continuity" | "other" | "still"; // still: a camera taking photos over USB (#136)
}

export interface Calibration {
  exposure: number;
  gain: number;
  p99: number;
  max_exposure?: number | null;
  at_light_limit?: boolean | null;
  manual?: boolean | null; // a still camera: exposure set on the camera, checked not calibrated
}

export interface StatusMessage {
  type: "status";
  hardware: {
    projector: Projector | null;
    /** Name of the chosen projector when it isn't plugged in (another display is used). */
    projector_missing: string | null;
    displays: DisplayInfo[];
    cameras: CameraInfo[];
    issues: HardwareIssue[];
  };
  output_connected: boolean;
  output_resolution: { width: number; height: number } | null;
  output_fps?: number | null;
  output_sound?: { level: number; error: string | null } | null;
  output_video_sound_blocked?: boolean;
  output_sound_output_error?: string | null;
  output_sound_channels?: number | null;
  /** The engine's verdicts (#142): the editor shows them and keeps no limits of its own.
   * battery: a still camera's last reading in percent, taken when the app uses it (null before). */
  camera: {
    selected: string | null;
    calibration: Calibration | null;
    at_light_limit: boolean;
    battery: number | null;
    battery_state: "ok" | "low" | "flat" | null;
  };
  /** Why Scan is disabled, in the editor's words; null when it can run. */
  scan_blocker: string | null;
  project: { name: string; slug: string } | null;
  can_scan: boolean;
  unsaved?: boolean; // the show differs from what was last saved or opened
}

export interface ShowTestFrameMessage {
  type: "show_test_frame";
  kind: TestFrameKind;
}

export type Pattern =
  | { kind: "white" }
  | { kind: "black" }
  | { kind: "gray"; axis: "x" | "y"; bit: number; inverse: boolean };

export interface ShowPatternMessage {
  type: "show_pattern";
  seq: number;
  pattern: Pattern;
}

/** A detected surface: polygon vertices in projector pixels. */
export interface Surface {
  polygon: [number, number][] | number[][];
  area: number;
}

export type ScanMessage =
  | { type: "scan_started" }
  | { type: "scan_progress"; done: number; total: number }
  | {
      type: "scan_result";
      coverage: number;
      seconds: number;
      bit_reliability: Record<string, Record<string, number>>;
      image: string;
      width: number;
      height: number;
      surfaces: Surface[];
      warnings?: string[];
    }
  | { type: "scan_failed"; error: string }
  | { type: "scan_canceled" };

export interface ShowSurface {
  id: number;
  name?: string;
  source?: "detected" | "edited" | "drawn";
  bezier?: { anchors: number[][]; controls: Record<number, [number[], number[]]> };
  edge?: number; // grow (+) or shrink (-) the lit area past the outline, in projector pixels
  polygon: number[][];
  area: number;
  effect: string;
  params: Record<string, unknown>;
}

export type MidiAction = "play" | "edit" | "blackout" | "next" | "previous";
export type MidiTarget = { surface: number; param: string } | { action: MidiAction };

/** A MIDI knob (cc) or key (note) bound to a setting or an action; saved with the show. */
export interface MidiBinding {
  kind: "cc" | "note";
  channel: number; // 0..15
  number: number; // 0..127
  target: MidiTarget;
}

export interface ShowMessage {
  type: "show";
  width: number;
  height: number;
  surfaces: ShowSurface[];
  selected: number | null;
  presentation: { mode: "edit" | "play"; blackout: boolean };
  alignment?: { corners: number[][]; brightness: number }; // realign the whole show (see output/alignment.ts)
  history?: { undo: string | null; redo: string | null }; // what Undo and Redo would do ("Merge")
  scenes?: { id: number; name: string; duration: number }[]; // effects and settings for the same surfaces, in playlist order
  scene?: number; // the open scene: its effects and settings are the surfaces' own
  playlist?: { crossfade: number; loop: boolean }; // Play mode plays the scenes in order
  midi?: MidiBinding[]; // knobs and keys bound to settings or actions
  sound?: { enabled: boolean; device: string | null; source?: "mic" | "video"; output?: string | null; delay?: number };
  scan_rev?: string | null; // changes only when the scan data changes
}

export interface ScanReloadMessage {
  type: "scan_reload";
}

/** No scan and no show any more (a new project). */
export interface ShowClearedMessage {
  type: "show_cleared";
}

export interface EffectErrorMessage {
  type: "effect_error";
  surface: number;
  effect: string;
  log: string;
}

/** To an output window: a newer one took over the projector (#159). */
export interface OutputReplacedMessage {
  type: "output_replaced";
}

/** To an output window: the newer one that replaced it closed; it owns the projector again (#169). */
export interface OutputRestoredMessage {
  type: "output_restored";
}

export type ServerMessage =
  | OutputRestoredMessage
  | OutputReplacedMessage
  | StatusMessage
  | ShowTestFrameMessage
  | ShowPatternMessage
  | ScanMessage
  | ShowMessage
  | EffectErrorMessage
  | ScanReloadMessage
  | ShowClearedMessage;

function isPattern(p: unknown): p is Pattern {
  if (typeof p !== "object" || p === null) return false;
  const q = p as Record<string, unknown>;
  if (q.kind === "white" || q.kind === "black") return true;
  return (
    q.kind === "gray" &&
    (q.axis === "x" || q.axis === "y") &&
    Number.isInteger(q.bit) &&
    typeof q.inverse === "boolean"
  );
}

export type ClientHello =
  | { type: "hello"; role: "editor" }
  | { type: "hello"; role: "output"; width: number; height: number };

/** Everything the browser sends the engine. Mirrors engine/messages.py (Hello, OutputMessage). */
export type ClientMessage =
  | ClientHello
  | { type: "pattern_shown"; seq: number }
  | {
      type: "output_stats";
      fps?: number;
      sound?: { level: number; error: string | null };
      video_sound_blocked?: boolean;
      sound_output_error?: string | null;
      sound_channels?: number;
    }
  | { type: "effect_error"; surface: number; effect: string; log: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The fields the Editor and output window read from a status message. */
function isStatus(m: Record<string, unknown>): boolean {
  const hw = m.hardware;
  return typeof m.can_scan === "boolean" && typeof m.output_connected === "boolean" && isObject(m.camera)
    && isObject(hw) && Array.isArray(hw.cameras) && Array.isArray(hw.displays) && Array.isArray(hw.issues);
}

function isShowSurface(s: unknown): boolean {
  return isObject(s) && typeof s.id === "number" && typeof s.effect === "string" && isObject(s.params)
    && Array.isArray(s.polygon) && s.polygon.every((p) => Array.isArray(p) && p.length === 2);
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  switch (m.type) {
    case "status":
      return isStatus(m) ? (m as unknown as StatusMessage) : null;
    case "output_replaced":
      return { type: "output_replaced" };
    case "output_restored":
      return { type: "output_restored" };
    case "show_test_frame":
      return TEST_FRAME_KINDS.includes(m.kind as TestFrameKind) ? (m as unknown as ShowTestFrameMessage) : null;
    case "show_pattern":
      return Number.isInteger(m.seq) && isPattern(m.pattern) ? (m as unknown as ShowPatternMessage) : null;
    case "scan_started":
      return m as unknown as ScanMessage;
    case "scan_progress":
      return typeof m.done === "number" && typeof m.total === "number" ? (m as unknown as ScanMessage) : null;
    case "scan_result":
      return typeof m.coverage === "number" && typeof m.image === "string" ? (m as unknown as ScanMessage) : null;
    case "scan_failed":
      return typeof m.error === "string" ? (m as unknown as ScanMessage) : null;
    case "scan_canceled":
      return { type: "scan_canceled" };
    case "show":
      return typeof m.width === "number" && typeof m.height === "number" && Array.isArray(m.surfaces)
        && m.surfaces.every(isShowSurface) && typeof m.presentation === "object" && m.presentation !== null
        ? (m as unknown as ShowMessage)
        : null;
    case "scan_reload":
      return { type: "scan_reload" };
    case "show_cleared":
      return { type: "show_cleared" };
    case "effect_error":
      return typeof m.surface === "number" && typeof m.log === "string" ? (m as unknown as EffectErrorMessage) : null;
    default:
      return null;
  }
}

/** GET/POST /api/camera/scan-settings: the selected camera's scan settings (engine/scan_settings.py). */
export interface ScanSettingsResponse {
  hole_fill: number; // px gap between decoded pixels the scan fills in
  hdr: number; // exposures per pattern: 1 = off
  mask: number[][][] | null; // areas of the camera image to skip (0..1); null = skip nothing
  aperture: string; // still cameras: f-number ("8" = f/8), or "camera"
}

/** POST /api/camera/calibrate: the exposure found (engine/calibrate.py). */
export type CalibrateResponse = Calibration;
