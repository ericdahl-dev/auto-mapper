// The Setup checklist (#168): the rig's setup order, each step's state from what the editor already
// knows (engine status, the last framing check, whether there's a scan), and the control that does it.

import type { StatusMessage } from "../shared/messages";
import { describeFraming, type FramingResult } from "./framingView";
import { describeStatus, outputOffProjector } from "./statusView";

export interface SetupStep {
  key: "projector" | "output" | "camera" | "framing" | "exposure" | "scan";
  label: string;
  state: string;
  /** done; todo: needed before a scan; warn: recommended, the scan runs without it. */
  level: "done" | "todo" | "warn";
  /** The control that does the step: pressed for a button, else shown and focused (a picker). */
  target: string;
  press: boolean;
}

type StepState = Omit<SetupStep, "target" | "press">;
const TARGETS: Record<SetupStep["key"], [string, boolean]> = {
  projector: ["projector-select", false], output: ["open-output", true], camera: ["camera-select", false],
  framing: ["check-framing", true], exposure: ["calibrate", true], scan: ["scan", true],
};

export function setupSteps(status: StatusMessage | null, framing: FramingResult | null, hasScan: boolean): SetupStep[] {
  const projector = status?.hardware.projector ?? null;
  const output: StepState = { key: "output", label: "Output window", state: "Open the output window", level: "todo" };
  if (status?.output_connected && projector) {
    if (outputOffProjector(status)) output.state = status.scan_blocker ?? `Make it fullscreen on ${projector.name}`;
    else Object.assign(output, { state: `Fullscreen on ${projector.name}`, level: "done" });
  }
  const camera = status?.hardware.cameras.find((c) => c.unique_id === status.camera.selected);
  const framed = framing && describeFraming(framing);
  const verdict = status?.camera.exposure?.verdict ?? null; // the engine's; no levels of our own
  const unchecked = camera?.device_type === "still"
    ? "Not checked: the scan checks a still camera's exposure first, and stops if it's wrong"
    : "Not checked (the scan will calibrate a webcam itself)";
  const steps: StepState[] = [
    projector ? { key: "projector", label: "Projector", state: projector.name, level: "done" }
      : { key: "projector", label: "Projector", state: "Connect the projector as an extended display", level: "todo" },
    output,
    camera ? { key: "camera", label: "Camera", state: camera.name, level: "done" }
      : { key: "camera", label: "Camera", state: "Choose a camera", level: "todo" },
    { key: "framing", label: "Framing", state: framed?.text ?? "Not checked", level: framed && !framed.warn ? "done" : "warn" },
    verdict === "good" ? { key: "exposure", label: "Exposure", state: "Good", level: "done" }
      : { key: "exposure", label: "Exposure", state: verdict === "light_limit" ? "At the camera's light limit" : unchecked, level: "warn" },
    hasScan ? { key: "scan", label: "Scan", state: "Scanned", level: "done" }
      : { key: "scan", label: "Scan", state: describeStatus(status).scanReason ?? "Ready", level: "todo" },
  ];
  return steps.map((s) => ({ ...s, target: TARGETS[s.key][0], press: TARGETS[s.key][1] }));
}

/** Said beside Scan while it can run: a still camera's unchecked exposure fails a scan two minutes in. */
export function scanWarning(status: StatusMessage | null): string | null {
  const camera = status?.hardware.cameras.find((c) => c.unique_id === status.camera.selected);
  return camera?.device_type === "still" && !status!.camera.exposure
    ? "Exposure not checked: the scan checks it first, and stops if it's wrong" : null;
}

/** Shown until there's a scan; after one, only when the projector, output window or camera needs doing again. */
export function setupNeeded(status: StatusMessage | null, hasScan: boolean): boolean {
  if (!hasScan) return true;
  return !!status && setupSteps(status, null, hasScan).some((s) => s.level === "todo" && s.key !== "scan");
}

/** Whether a latest-scan answer says if there's a scan: 200 there is, 404 there isn't. Anything else
 *  (the dev proxy's 502 while the engine is down) or a failed request (null) is no answer yet. */
export function scanAnswered(r: Response | null): boolean {
  return !!r && (r.ok || r.status === 404);
}
