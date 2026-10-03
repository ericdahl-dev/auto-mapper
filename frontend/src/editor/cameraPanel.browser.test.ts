import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../index.html?raw";
import type { StatusMessage } from "../shared/messages";
import { mountCameraPanel } from "./cameraPanel";
import type { EngineClient } from "./engineClient";

// The Camera section (#146), on the Editor's real markup, against a fake engine.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeEngine(over: Partial<Record<keyof EngineClient, (...a: never[]) => Promise<Response>>> = {}) {
  const calls: string[] = [];
  const record = (name: string, res: () => Response) => async (...args: unknown[]) => {
    calls.push(args.length ? `${name} ${JSON.stringify(args[0])}` : name);
    return res();
  };
  const engine = {
    scanSettings: record("scanSettings", () => json({ hole_fill: 4, hdr: 2, mask: null, aperture: "5.6" })),
    setScanSettings: record("setScanSettings", () => json({})),
    releaseCamera: record("releaseCamera", () => json({ ok: true })),
    calibrate: record("calibrate", () => json({ exposure: 1200, gain: 3, p99: 201.4 })),
    checkFraming: record("checkFraming", () => json({ span: 0.8, cut_off: false, outline: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]], advice: null })),
    ...over,
  } as unknown as EngineClient;
  return { engine, calls };
}

const A6600 = { name: "Sony Alpha-A6600", unique_id: "gphoto2:Sony", device_type: "still" as const };
const AC410 = { name: "Webcam AC410", unique_id: "0x2110000f1311306", device_type: "external" as const };

function status(selected: typeof A6600 | typeof AC410): StatusMessage {
  return {
    type: "status",
    hardware: { projector: { name: "TV", key: "tv", width: 8, height: 4 }, projector_missing: null, displays: [], cameras: [A6600, AC410], issues: [] },
    output_connected: true, output_resolution: { width: 8, height: 4 },
    camera: { selected: selected.unique_id, calibration: null, at_light_limit: false, battery: null, battery_state: null },
    project: null, can_scan: true, scan_blocker: null,
  } as StatusMessage;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

beforeEach(() => {
  document.body.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
});

describe("the Camera section", () => {
  it("shows the selected camera's scan settings, and Aperture only for a still camera", async () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(A6600), false);
    await panel.loadScanSettings();
    expect($<HTMLInputElement>("hole-fill").value).toBe("4");
    expect($("hole-fill-readout").textContent).toBe("4 px");
    expect($<HTMLSelectElement>("hdr").value).toBe("2");
    expect($<HTMLSelectElement>("aperture").value).toBe("5.6");
    expect($("aperture-row").hidden).toBe(false);
    panel.update(status(AC410), false);
    expect($("aperture-row").hidden).toBe(true);
  });

  it("shows each new photo and lets go of the old ones, and of the camera when hidden", async () => {
    const { engine, calls } = fakeEngine();
    let n = 0;
    const fetchPreview = async () => new Response(new Blob([`photo ${++n}`], { type: "image/jpeg" }));
    const made: string[] = [], revoked: string[] = [];
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => { made.push(`blob:${made.length}`); return made.at(-1)!; });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => { revoked.push(u); });
    const panel = mountCameraPanel({ engine, notice: () => {}, fetchPreview });
    $("preview-toggle").click();
    await vi.waitFor(() => expect(made.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect($<HTMLImageElement>("preview").src).toBe(made.at(-1));
    expect(revoked).toContain(made[0]); // replaced photos are let go
    $("preview-toggle").click();
    expect(panel.previewRunning()).toBe(false);
    expect(revoked).toContain(made.at(-1)); // and the last one when hidden
    expect(calls).toContain("releaseCamera");
    create.mockRestore();
    revoke.mockRestore();
  });

  it("says what calibration found, and lets the camera go when not previewing", async () => {
    const { engine, calls } = fakeEngine();
    const notices: string[] = [];
    const panel = mountCameraPanel({ engine, notice: (t) => notices.push(t) });
    panel.update(status(AC410), false);
    $("calibrate").click();
    await vi.waitFor(() => expect(notices).toEqual(["Calibrated: exposure 1200, white peak 201"]));
    await vi.waitFor(() => expect(calls).toContain("releaseCamera"));
    expect($("calibrate").textContent).toBe("Calibrate exposure");
  });

  it("says why calibration failed", async () => {
    const { engine } = fakeEngine({ calibrate: async () => json({ detail: "Output window is not connected" }, 409) });
    const notices: string[] = [];
    const panel = mountCameraPanel({ engine, notice: (t) => notices.push(t) });
    panel.update(status(AC410), false);
    $("calibrate").click();
    await vi.waitFor(() => expect(notices).toEqual(["Calibration failed: Output window is not connected"]));
  });

  it("outlines the projection after a framing check", async () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(AC410), false);
    $("check-framing").click();
    await vi.waitFor(() => expect($("framing-note").hidden).toBe(false));
    expect($("framing-note").textContent).toBe("Framed well: the projection fills 80% of the camera's view.");
    expect(document.querySelector("#framing-overlay polygon")!.getAttribute("points")).toBe("0.1,0.1 0.9,0.1 0.9,0.9");
  });

  it("can't check framing or calibrate without the output window, or check framing during a scan", () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update({ ...status(AC410), output_connected: false }, false);
    expect($<HTMLButtonElement>("calibrate").disabled).toBe(true);
    panel.update(status(AC410), true);
    expect($<HTMLButtonElement>("calibrate").disabled).toBe(false);
    expect($<HTMLButtonElement>("check-framing").disabled).toBe(true);
  });

  it("saves a scan setting as it's changed", () => {
    const { engine, calls } = fakeEngine();
    mountCameraPanel({ engine, notice: () => {} });
    const hdr = $<HTMLSelectElement>("hdr");
    hdr.value = "3";
    hdr.dispatchEvent(new Event("change"));
    expect(calls).toContain('setScanSettings {"hdr":3}');
  });
});
