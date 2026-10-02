// Message shapes shared with the engine. Mirrors engine/messages.py and engine/hub.py.

export type TestFrameKind = "white" | "black" | "grid";
export const TEST_FRAME_KINDS: readonly TestFrameKind[] = ["white", "black", "grid"];

export interface Projector {
  name: string;
  width: number;
  height: number;
}

export type HardwareIssue = "no_projector" | "no_camera";

export interface CameraInfo {
  name: string;
  unique_id: string;
  device_type: "builtin" | "external" | "continuity" | "other";
}

export interface Calibration {
  exposure: number;
  gain: number;
  p99: number;
}

export interface StatusMessage {
  type: "status";
  hardware: { projector: Projector | null; cameras: CameraInfo[]; issues: HardwareIssue[] };
  output_connected: boolean;
  output_resolution: { width: number; height: number } | null;
  camera: { selected: string | null; calibration: Calibration | null };
  can_scan: boolean;
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
    }
  | { type: "scan_failed"; error: string };

export type ServerMessage = StatusMessage | ShowTestFrameMessage | ShowPatternMessage | ScanMessage;

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
      return typeof m.can_scan === "boolean" && typeof m.hardware === "object" ? (m as unknown as StatusMessage) : null;
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
    default:
      return null;
  }
}
