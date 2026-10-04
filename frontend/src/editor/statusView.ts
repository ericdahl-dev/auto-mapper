import type { Calibration, CameraInfo, HardwareIssue, StatusMessage } from "../shared/messages";

export interface StatusView {
  /** Problems that stop the work: full-width banners. */
  banners: string[];
  /** Lasting information that doesn't stop the work: shown in the Hardware section. */
  notes: string[];
  scanEnabled: boolean;
  /** Why Scan is disabled, for its tooltip and beside it; null when it can run. */
  scanReason: string | null;
  projector: string;
  output: string;
  calibration: string;
  project: string;
  /** "Battery 64%" for a still camera that has reported it, else null. */
  battery: string | null;
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
      notes: [],
      scanEnabled: false,
      scanReason: "The engine isn't running: start it with make dev",
      projector: "Unknown",
      output: "Unknown",
      calibration: "Unknown",
      project: "Unknown",
      battery: null,
    };
  }

  const { projector, issues } = status.hardware;
  const out = status.output_resolution;
  const banners = issues.map((i) => ISSUE_TEXT[i]);
  const notes: string[] = [];
  if (status.hardware.projector_missing && projector) {
    notes.push(`${status.hardware.projector_missing} (your chosen projector) is not connected. Using ${projector.name} for now.`);
  }

  // The engine judges the battery (#142).
  const battery = status.camera.battery;
  if (status.camera.battery_state === "flat") {
    banners.push(`Camera battery is at ${battery}%: charge or swap it before scanning.`);
  } else if (status.camera.battery_state === "low") {
    notes.push(`Camera battery is at ${battery}%: charge or swap it soon.`);
  }

  if (status.output_sound_output_error) banners.push(status.output_sound_output_error);
  if (status.output_video_sound_blocked) {
    banners.push("Video sound is waiting: click the output window once to allow it.");
  }
  if (!status.output_connected) {
    banners.push("Output window not connected. Open it and move it fullscreen onto the projector.");
  } else if (projector && out && (out.width !== projector.width || out.height !== projector.height)) {
    banners.push(`Output window is ${size(out)} but the projector is ${size(projector)}. Make it fullscreen on the projector.`);
  }

  return {
    banners,
    notes,
    scanEnabled: status.can_scan,
    scanReason: status.can_scan ? null : status.scan_blocker ?? "The rig isn't ready to scan",
    projector: projector ? `${projector.name} (${size(projector)})` : "None",
    output: status.output_connected && out ? `Output connected (${size(out)})` : "Output not connected",
    calibration: describeCalibration(status.camera.calibration, status.camera.at_light_limit),
    project: status.project?.name ?? "Unsaved",
    battery: battery === null ? null : `Battery ${battery}%`,
  };
}

function describeCalibration(c: Calibration | null, atLightLimit: boolean): string {
  if (!c) return "Not calibrated";
  if (c.manual) return `Set on the camera (white frame peak ${Math.round(c.p99)})`;
  const text = `Exposure ${c.exposure}, gain ${c.gain} (white frame peak ${Math.round(c.p99)})`;
  return atLightLimit ? `${text} - camera at its light limit` : text;
}

// USB webcams have uniqueIDs like 0x2110000f1311306 (location + vendor + product).
const isUsb = (uniqueId: string) => /^0x[0-9a-f]{9,}$/i.test(uniqueId);
const KIND_LABEL: Record<CameraInfo["device_type"], string> = {
  builtin: "built-in", external: "external", continuity: "phone", other: "other", still: "photos over USB",
};

export function projectorOptions(status: StatusMessage | null): CameraOption[] {
  if (!status) return [];
  return status.hardware.displays.map((d) => ({
    value: d.key,
    label: `${d.name} (${size(d)}${d.main ? ", main" : ""})`,
    selected: d.key === status.hardware.projector?.key,
  }));
}

export function cameraOptions(status: StatusMessage | null): CameraOption[] {
  if (!status) return [];
  return status.hardware.cameras.map((c) => ({
    value: c.unique_id,
    label: `${c.name} (${isUsb(c.unique_id) ? "USB" : KIND_LABEL[c.device_type]})`,
    selected: c.unique_id === status.camera.selected,
  }));
}
