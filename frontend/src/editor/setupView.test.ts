import { describe, expect, it } from "vitest";
import type { CameraInfo, StatusMessage } from "../shared/messages";
import { scanWarning, setupNeeded, setupSteps } from "./setupView";

const AC410: CameraInfo = { name: "Webcam AC410", unique_id: "0x2110000f1311306", device_type: "external" };
const A6600: CameraInfo = { name: "Sony Alpha-A6600", unique_id: "gphoto2:Sony", device_type: "still" };

function status(over: Partial<StatusMessage> = {}, camera: Partial<StatusMessage["camera"]> = {}): StatusMessage {
  return {
    type: "status",
    hardware: {
      projector: { name: "AML TV", key: "aml", width: 1920, height: 1080 },
      projector_missing: null, displays: [], cameras: [AC410, A6600], issues: [],
    },
    output_connected: true,
    output_resolution: { width: 1920, height: 1080 },
    camera: { selected: AC410.unique_id, calibration: null, at_light_limit: false, exposure: null, battery: null, battery_state: null, ...camera },
    project: null, can_scan: true, scan_blocker: null,
    ...over,
  };
}

const step = (key: string, s: StatusMessage | null, hasScan = false) => setupSteps(s, null, hasScan).find((x) => x.key === key)!;

describe("the setup checklist (#168)", () => {
  it("lists the steps in setup order", () => {
    expect(setupSteps(status(), null, false).map((s) => s.label)).toEqual(
      ["Projector", "Output window", "Camera", "Framing", "Exposure", "Scan"],
    );
  });

  it("names the projector, or says to connect one", () => {
    expect(step("projector", status())).toMatchObject({ level: "done", state: "AML TV" });
    const none = status();
    none.hardware = { ...none.hardware, projector: null, issues: ["no_projector"] };
    expect(step("projector", none)).toMatchObject({ level: "todo", state: "Connect the projector as an extended display" });
  });

  it("says to open the output window, then to put it fullscreen on the projector", () => {
    expect(step("output", status({ output_connected: false, output_resolution: null }))).toMatchObject({ level: "todo", state: "Open the output window" });
    const off = status({ output_resolution: { width: 800, height: 600 } });
    expect(step("output", off)).toMatchObject({ level: "todo", state: "Make it fullscreen on AML TV" });
    expect(step("output", { ...off, scan_blocker: "It's on Color LCD: move it to AML TV" }).state).toBe("It's on Color LCD: move it to AML TV");
    expect(step("output", status())).toMatchObject({ level: "done", state: "Fullscreen on AML TV" });
  });

  it("names the chosen camera, or says to choose one", () => {
    expect(step("camera", status())).toMatchObject({ level: "done", state: "Webcam AC410" });
    expect(step("camera", status({}, { selected: null }))).toMatchObject({ level: "todo", state: "Choose a camera" });
  });

  it("shows the last framing check, which is recommended, not required", () => {
    expect(step("framing", status())).toMatchObject({ level: "warn", state: "Not checked" });
    const framed = (f: Parameters<typeof setupSteps>[1]) => setupSteps(status(), f, false).find((x) => x.key === "framing")!;
    expect(framed({ span: 0.82, cut_off: false, outline: [], advice: null }))
      .toMatchObject({ level: "done", state: "Framed well: the projection fills 82% of the camera's view." });
    expect(framed({ span: 0.3, cut_off: false, outline: [], advice: "Move the camera closer" }))
      .toMatchObject({ level: "warn", state: "Move the camera closer" });
  });

  it("shows the engine's exposure verdict, and what an unchecked one means for this kind of camera", () => {
    const range = { low: null, high: 250, target: 200 };
    expect(step("exposure", status())).toMatchObject({ level: "warn", state: "Not checked (the scan will calibrate a webcam itself)" });
    expect(step("exposure", status({}, { selected: A6600.unique_id })))
      .toMatchObject({ level: "warn", state: "Not checked: the scan checks a still camera's exposure first, and stops if it's wrong" });
    expect(step("exposure", status({}, { exposure: { verdict: "good", ...range } }))).toMatchObject({ level: "done", state: "Good" });
    expect(step("exposure", status({}, { exposure: { verdict: "light_limit", ...range } })))
      .toMatchObject({ level: "warn", state: "At the camera's light limit" });
  });

  it("ends with Scan: why it can't run yet, ready, or done", () => {
    expect(step("scan", status({ can_scan: false, scan_blocker: "Choose a camera first" }))).toMatchObject({ level: "todo", state: "Choose a camera first" });
    expect(step("scan", status())).toMatchObject({ level: "todo", state: "Ready" });
    expect(step("scan", status(), true)).toMatchObject({ level: "done", state: "Scanned" });
    expect(step("scan", null).state).toBe("The engine isn't running: start it with make dev");
  });
});

describe("when the checklist is needed (#168)", () => {
  it("while there's no scan yet; after one, only when a required step stops being met", () => {
    expect(setupNeeded(status(), false)).toBe(true);
    expect(setupNeeded(status(), true)).toBe(false); // framing and exposure unchecked: recommended only
    expect(setupNeeded(status({ output_connected: false, output_resolution: null }), true)).toBe(true);
    expect(setupNeeded(status({}, { selected: null }), true)).toBe(true);
    expect(setupNeeded(null, true)).toBe(false); // the engine is down: its banner says so, not the checklist
  });
});

describe("beside Scan, while it can run (#168)", () => {
  it("warns that a still camera's exposure isn't checked, and nothing otherwise", () => {
    const still = status({}, { selected: A6600.unique_id });
    expect(scanWarning(still)).toBe("Exposure not checked: the scan checks it first, and stops if it's wrong");
    expect(scanWarning(status({}, { selected: A6600.unique_id, exposure: { verdict: "good", low: 140, high: 250, target: null } }))).toBeNull();
    expect(scanWarning(status())).toBeNull(); // a webcam calibrates itself
    expect(scanWarning(null)).toBeNull();
  });
});
