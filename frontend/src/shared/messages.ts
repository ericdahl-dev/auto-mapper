// Message shapes shared with the engine. Mirrors engine/messages.py and engine/hub.py.

export type TestFrameKind = "white" | "black" | "grid";
export const TEST_FRAME_KINDS: readonly TestFrameKind[] = ["white", "black", "grid"];

export interface Projector {
  name: string;
  width: number;
  height: number;
}

export type HardwareIssue = "no_projector" | "no_camera";

export interface StatusMessage {
  type: "status";
  hardware: { projector: Projector | null; cameras: string[]; issues: HardwareIssue[] };
  output_connected: boolean;
  output_resolution: { width: number; height: number } | null;
  can_scan: boolean;
}

export interface ShowTestFrameMessage {
  type: "show_test_frame";
  kind: TestFrameKind;
}

export type ServerMessage = StatusMessage | ShowTestFrameMessage;

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
    default:
      return null;
  }
}
