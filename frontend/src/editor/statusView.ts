import type { HardwareIssue, StatusMessage } from "../shared/messages";

export interface StatusView {
  banners: string[];
  scanEnabled: boolean;
  projector: string;
  output: string;
}

const ISSUE_TEXT: Record<HardwareIssue, string> = {
  no_projector: "No projector detected. Connect it as an extended display, then refresh hardware.",
  no_camera: "No camera detected. Plug in the webcam, then refresh hardware.",
};

const size = (r: { width: number; height: number }) => `${r.width}×${r.height}`;

/** Turns engine status (null = engine unreachable) into what the editor shows. */
export function describeStatus(status: StatusMessage | null): StatusView {
  if (status === null) {
    return {
      banners: ["Engine not reachable. Is `make dev` running?"],
      scanEnabled: false,
      projector: "Unknown",
      output: "Unknown",
    };
  }

  const { projector, issues } = status.hardware;
  const out = status.output_resolution;
  const banners = issues.map((i) => ISSUE_TEXT[i]);

  if (!status.output_connected) {
    banners.push("Output window not connected. Open it and move it fullscreen onto the projector.");
  } else if (projector && out && (out.width !== projector.width || out.height !== projector.height)) {
    banners.push(`Output window is ${size(out)} but the projector is ${size(projector)}. Make it fullscreen on the projector.`);
  }

  return {
    banners,
    scanEnabled: status.can_scan,
    projector: projector ? `${projector.name} (${size(projector)})` : "None",
    output: status.output_connected && out ? `Output connected (${size(out)})` : "Output not connected",
  };
}
