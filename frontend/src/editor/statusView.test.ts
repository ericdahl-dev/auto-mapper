import { describe, expect, it } from "vitest";
import type { CameraInfo, StatusMessage } from "../shared/messages";
import { cameraOptions, describeStatus, projectorOptions } from "./statusView";

const AC410: CameraInfo = { name: "Webcam AC410", unique_id: "0x2110000f1311306", device_type: "external" };
const FACETIME: CameraInfo = { name: "FaceTime HD Camera", unique_id: "3F45E80A", device_type: "builtin" };

function status(over: Partial<StatusMessage> = {}, issues: StatusMessage["hardware"]["issues"] = []): StatusMessage {
  return {
    type: "status",
    hardware: {
      projector: issues.includes("no_projector") ? null : { name: "AML TV", key: "aml", width: 1920, height: 1080 },
      projector_missing: null,
      displays: [
        { name: "Color LCD", key: "lcd", width: 3456, height: 2234, main: true },
        { name: "AML TV", key: "aml", width: 1920, height: 1080, main: false },
      ],
      cameras: issues.includes("no_camera") ? [] : [FACETIME, AC410],
      issues,
    },
    output_connected: true,
    output_resolution: { width: 1920, height: 1080 },
    camera: { selected: issues.includes("no_camera") ? null : AC410.unique_id, calibration: null },
    project: null,
    can_scan: issues.length === 0,
    ...over,
  };
}

describe("describeStatus", () => {
  it("is ready with no banners when everything is connected", () => {
    const view = describeStatus(status());
    expect(view.banners).toEqual([]);
    expect(view.scanEnabled).toBe(true);
    expect(view.output).toBe("Output connected (1920×1080)");
    expect(view.projector).toBe("AML TV (1920×1080)");
  });

  it("explains a missing projector and disables scan", () => {
    const view = describeStatus(status({}, ["no_projector"]));
    expect(view.banners).toContain("No projector detected. Connect it as an extended display, then refresh hardware.");
    expect(view.scanEnabled).toBe(false);
  });

  it("explains a missing camera and disables scan", () => {
    const view = describeStatus(status({}, ["no_camera"]));
    expect(view.banners).toContain("No camera detected. Plug in the webcam, then refresh hardware.");
    expect(view.scanEnabled).toBe(false);
  });

  it("asks for the output window when it is not connected", () => {
    const view = describeStatus(status({ output_connected: false, output_resolution: null, can_scan: false }));
    expect(view.banners).toContain("Output window not connected. Open it and move it fullscreen onto the projector.");
    expect(view.output).toBe("Output not connected");
    expect(view.scanEnabled).toBe(false);
  });

  it("warns when the output window size does not match the projector", () => {
    const view = describeStatus(status({ output_resolution: { width: 1280, height: 720 }, can_scan: false }));
    expect(view.banners).toContain("Output window is 1280×720 but the projector is 1920×1080. Make it fullscreen on the projector.");
    expect(view.scanEnabled).toBe(false);
  });

  it("reports a lost engine connection", () => {
    const view = describeStatus(null);
    expect(view.banners).toEqual(["Engine not reachable. Is `make dev` running?"]);
    expect(view.scanEnabled).toBe(false);
  });
});

describe("cameraOptions", () => {
  it("labels a still camera over USB", () => {
    const a6600: CameraInfo = { name: "Sony Alpha-A6600", unique_id: "gphoto2:Sony Alpha-A6600 (PC Control)", device_type: "still" };
    const s = status();
    s.hardware.cameras = [a6600];
    expect(cameraOptions(s)[0].label).toBe("Sony Alpha-A6600 (photos over USB)");
  });

  it("lists cameras, marks the selected one and flags non-USB cameras", () => {
    expect(cameraOptions(status())).toEqual([
      { value: "3F45E80A", label: "FaceTime HD Camera (built-in)", selected: false },
      { value: "0x2110000f1311306", label: "Webcam AC410 (USB)", selected: true },
    ]);
  });

  it("is empty when the engine is unreachable", () => {
    expect(cameraOptions(null)).toEqual([]);
  });
});

describe("calibration summary", () => {
  it("shows the saved exposure for the selected camera", () => {
    const view = describeStatus(status({ camera: { selected: AC410.unique_id, calibration: { exposure: 124, gain: 0, p99: 248 } } }));
    expect(view.calibration).toBe("Exposure 124, gain 0 (white frame peak 248)");
  });

  it("says when the camera is not calibrated", () => {
    expect(describeStatus(status()).calibration).toBe("Not calibrated");
  });
});

describe("project label", () => {
  it("names the open project, or says none is open", () => {
    expect(describeStatus(status({ project: { name: "Kitchen island", slug: "kitchen-island" } })).project).toBe("Kitchen island");
    expect(describeStatus(status({ project: null })).project).toBe("Unsaved");
  });
});

describe("calibration at the camera's limit", () => {
  it("says so when exposure and gain are both maxed out", () => {
    const view = describeStatus(status({ camera: { selected: AC410.unique_id, calibration: { exposure: 1000, gain: 15, p99: 120 } } }));
    expect(view.calibration).toBe("Exposure 1000, gain 15 (white frame peak 120) - camera at its light limit");
  });
});

describe("cameras", () => {
  it("are chosen in the Hardware panel's camera dropdown (cameraOptions), not listed as text", () => {
    expect("cameras" in describeStatus(status())).toBe(false);
  });
});

describe("projectorOptions", () => {
  it("lists every display with its size, the current projector selected", () => {
    expect(projectorOptions(status())).toEqual([
      { value: "lcd", label: "Color LCD (3456×2234, main)", selected: false },
      { value: "aml", label: "AML TV (1920×1080)", selected: true },
    ]);
  });
});

describe("a chosen projector that is unplugged", () => {
  it("says which display is being used instead", () => {
    const s = status();
    s.hardware.projector_missing = "P24q-10";
    expect(describeStatus(s).notes).toContain("P24q-10 (your chosen projector) is not connected. Using AML TV for now.");
  });

  it("is a note in the Hardware section, not a banner: the work goes on with the other display", () => {
    const s = status();
    s.hardware.projector_missing = "P24q-10";
    expect(describeStatus(s).banners).toEqual([]);
  });
});

describe("video sound waiting for a click", () => {
  it("tells the user to click the output window", () => {
    expect(describeStatus(status({ output_video_sound_blocked: true })).banners).toContain(
      "Video sound is waiting: click the output window once to allow it.",
    );
    expect(describeStatus(status({ output_video_sound_blocked: false })).banners).toEqual([]);
  });
});

describe("sound output errors", () => {
  it("shows why the chosen sound output isn't used", () => {
    expect(describeStatus(status({ output_sound_output_error: "That sound output is not available. Pick another output." })).banners)
      .toContain("That sound output is not available. Pick another output.");
  });
});

describe("why Scan is disabled", () => {
  it("gives no reason when the rig can scan", () => {
    expect(describeStatus(status()).scanReason).toBeNull();
  });

  it("names what stops the scan, first things first", () => {
    const reason = (s: StatusMessage | null) => describeStatus(s).scanReason;
    expect(reason(null)).toBe("The engine isn't running: start it with make dev");
    expect(reason(status({}, ["no_projector"]))).toBe("No projector: connect it as an extended display");
    expect(reason(status({}, ["no_camera"]))).toBe("No camera: plug in the webcam");
    expect(reason(status({ output_connected: false, output_resolution: null, can_scan: false })))
      .toBe("Open the output window (Hardware) and make it fullscreen on the projector");
    expect(reason(status({ output_resolution: { width: 1920, height: 927 }, can_scan: false })))
      .toBe("Output window must be 1920×1080: make it fullscreen on the projector");
    expect(reason(status({ camera: { selected: null, calibration: null }, can_scan: false })))
      .toBe("Choose the camera that scans (Hardware)");
  });
});
