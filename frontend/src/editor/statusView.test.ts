import { describe, expect, it } from "vitest";
import type { CameraInfo, StatusMessage } from "../shared/messages";
import { cameraOptions, describeStatus, projectorOptions } from "./statusView";

const AC410: CameraInfo = { name: "Webcam AC410", unique_id: "0x2110000f1311306", device_type: "external" };
const FACETIME: CameraInfo = { name: "FaceTime HD Camera", unique_id: "3F45E80A", device_type: "builtin" };

function camera(over: Partial<StatusMessage["camera"]> = {}): StatusMessage["camera"] {
  return { selected: AC410.unique_id, calibration: null, at_light_limit: false, exposure: null, battery: null, battery_state: null, ...over };
}

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
    camera: camera({ selected: issues.includes("no_camera") ? null : AC410.unique_id }),
    project: null,
    can_scan: issues.length === 0,
    scan_blocker: null,
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

// The verdict and its range come from the engine (#172): the editor keeps no levels of its own, so these
// are numbers the engine doesn't use. A copy of 120/180/249 in the frontend would fail these tests.
const WEBCAM_GOOD = { verdict: "good", low: null, high: 230, target: 150 } as const;
const STILL_GOOD = { verdict: "good", low: 100, high: 230, target: null } as const;

describe("calibration summary", () => {
  it("leads with the verdict, then the white level against the engine's range", () => {
    const view = describeStatus(status({ camera: camera({ calibration: { exposure: 124, gain: 0, p99: 248 }, exposure: WEBCAM_GOOD }) }));
    expect(view.calibration).toBe("Good (white at 248 of 255; aiming near 150, at most 230): exposure 124, gain 0, set by the app");
  });

  it("doesn't look like a step blocking the scan when nothing is saved", () => {
    expect(describeStatus(status()).calibration).toBe("Not checked yet: the scan checks it first, or check exposure now");
  });
});

describe("project label", () => {
  it("names the open project, or says none is open", () => {
    expect(describeStatus(status({ project: { name: "Kitchen island", slug: "kitchen-island" } })).project).toBe("Kitchen island");
    expect(describeStatus(status({ project: null })).project).toBe("Unsaved");
  });
});

describe("calibration at the camera's limit", () => {
  const calibration = { exposure: 1000, gain: 15, p99: 120 };

  it("says so, and what to change, when the engine says the camera is at its light limit", () => {
    const exposure = { ...WEBCAM_GOOD, verdict: "light_limit" } as const;
    const view = describeStatus(status({ camera: camera({ calibration, at_light_limit: true, exposure }) }));
    expect(view.calibration).toBe("At the camera's light limit (white at 120 of 255; aiming near 150, at most 230): "
      + "brighten the projector, darken the room or move the camera closer");
  });

  it("keeps no limits of its own: the engine decides, per camera (#142)", () => {
    // 100 ms and gain 15 was the AC410's old limit; a still camera goes to seconds.
    const view = describeStatus(status({ camera: camera({ calibration, at_light_limit: false, exposure: WEBCAM_GOOD }) }));
    expect(view.calibration).toMatch(/^Good /);
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

  it("shows the engine's reason, which decides readiness (#142)", () => {
    const reason = (s: StatusMessage | null) => describeStatus(s).scanReason;
    expect(reason(null)).toBe("The engine isn't running: start it with make dev");
    expect(reason(status({ can_scan: false, scan_blocker: "The camera battery is at 8%: charge or swap it before scanning" })))
      .toBe("The camera battery is at 8%: charge or swap it before scanning");
  });
});

describe("camera battery (still cameras)", () => {
  const cam = (battery: number | null, battery_state: StatusMessage["camera"]["battery_state"]) =>
    describeStatus(status({ camera: camera({ battery, battery_state }) }));

  it("shows the last reading, and nothing before the camera is used", () => {
    expect(cam(64, "ok").battery).toBe("Battery 64%");
    expect(cam(null, null).battery).toBeNull();
    expect(cam(64, "ok").notes).toEqual([]);
  });

  it("warns as the engine judges it, keeping no thresholds of its own (#142)", () => {
    expect(cam(25, "low").notes).toEqual(["Camera battery is at 25%: charge or swap it soon."]);
    expect(cam(15, "flat").banners).toContain("Camera battery is at 15%: charge or swap it before scanning.");
  });
});

describe("a still camera's exposure", () => {
  it("is the camera's own, checked by the engine", () => {
    const calibration = { exposure: 167, gain: 0, p99: 201.4, manual: true };
    expect(describeStatus(status({ camera: camera({ calibration, exposure: STILL_GOOD }) })).calibration)
      .toBe("Good (white at 201 of 255; a still camera needs 100 to 230): set on the camera, checked by the app");
  });
});

describe("the output window not on the projector (#169)", () => {
  it("is explained once, in the engine's words, with Scan's reason pointing at it", () => {
    const blocker = "The output window seems to be on Color LCD, not AML TV: move it there and make it fullscreen.";
    const view = describeStatus(status({ output_resolution: { width: 3456, height: 2034 }, can_scan: false, scan_blocker: blocker }));
    expect(view.banners.filter((b) => /output window/i.test(b))).toEqual([blocker]);
    expect(view.scanReason).toBe("The output window isn't on the projector: see above");
  });
});

