import type { Calibration, CameraInfo, HardwareIssue, StatusMessage } from "../shared/messages";

export interface StatusView {
  banners: string[];
  scanEnabled: boolean;
  projector: string;
  output: string;
  calibration: string;
  project: string;
}

export interface CameraOption {
  value: string;
  label: string;
  selected: boolean;
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
      calibration: "Unknown",
      project: "Unknown",
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
    calibration: describeCalibration(status.camera.calibration),
    project: status.project?.name ?? "Unsaved",
  };
}

// Mirrors engine/calibrate.py: longest exposure within one frame, and the AC410's gain range.
const MAX_EXPOSURE = 330;
const MAX_GAIN = 15;

function describeCalibration(c: Calibration | null): string {
  if (!c) return "Not calibrated";
  const text = `Exposure ${c.exposure}, gain ${c.gain} (white frame peak ${Math.round(c.p99)})`;
  return c.exposure >= MAX_EXPOSURE && c.gain >= MAX_GAIN ? `${text} - camera at its light limit` : text;
}

// USB webcams have uniqueIDs like 0x2110000f1311306 (location + vendor + product).
const isUsb = (uniqueId: string) => /^0x[0-9a-f]{9,}$/i.test(uniqueId);
const KIND_LABEL: Record<CameraInfo["device_type"], string> = {
  builtin: "built-in", external: "external", continuity: "phone", other: "other",
};

export function cameraOptions(status: StatusMessage | null): CameraOption[] {
  if (!status) return [];
  return status.hardware.cameras.map((c) => ({
    value: c.unique_id,
    label: `${c.name} (${isUsb(c.unique_id) ? "USB" : KIND_LABEL[c.device_type]})`,
    selected: c.unique_id === status.camera.selected,
  }));
}
