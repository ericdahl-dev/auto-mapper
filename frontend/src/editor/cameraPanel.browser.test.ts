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
    camera: { selected: selected.unique_id, calibration: null, at_light_limit: false, exposure: null, battery: null, battery_state: null },
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

  it("says it adjusted a webcam, and lets the camera go when not previewing", async () => {
    const { engine, calls } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(AC410), false);
    $("calibrate").click();
    await vi.waitFor(() => expect($("exposure-note").hidden).toBe(false));
    expect($("exposure-note").textContent).toBe("Good: adjusted the camera to exposure 1200, gain 3");
    expect($("exposure-note").classList.contains("warn")).toBe(false);
    await vi.waitFor(() => expect(calls).toContain("releaseCamera"));
    expect($("calibrate").textContent).toBe("Check exposure");
  });

  it("leads with the light limit when the camera has no more to give (#172)", async () => {
    const { engine } = fakeEngine({ calibrate: async () => json({ exposure: 1000, gain: 15, p99: 120, at_light_limit: true }) });
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(AC410), false);
    $("calibrate").click();
    await vi.waitFor(() => expect($("exposure-note").textContent)
      .toBe("At the camera's light limit: adjusted the camera to exposure 1000, gain 15"));
  });

  it("keeps why calibration failed in the section until another camera is chosen (#171)", async () => {
    const { engine } = fakeEngine({ calibrate: async () => json({ detail: "Output window is not connected" }, 409) });
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(AC410), false);
    $("calibrate").click();
    await vi.waitFor(() => expect($("exposure-note").textContent).toBe("Output window is not connected"));
    expect($("exposure-note").classList.contains("warn")).toBe(true);
    panel.update(status(AC410), false);
    expect($("exposure-note").hidden).toBe(false);
    panel.update(status(A6600), false);
    expect($("exposure-note").hidden).toBe(true);
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

  it("says beside them why calibrate and the framing check can't run without the output window (#173)", () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update({ ...status(AC410), output_connected: false }, false);
    for (const id of ["calibrate", "check-framing"]) {
      expect($<HTMLButtonElement>(id).disabled).toBe(true);
      expect($(id).title).toBe("Open the output window first");
    }
    expect($("camera-reason").hidden).toBe(false);
    expect($("camera-reason").textContent).toBe("Open the output window first");
    panel.update(status(AC410), false);
    expect($<HTMLButtonElement>("calibrate").disabled).toBe(false);
    expect($("camera-reason").hidden).toBe(true);
    expect($("check-framing").title).toMatch(/^Shows white, then black/); // its description is back
  });

  it("says to choose a camera when none is, and to start the engine when it's down (#173)", () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    const none = status(AC410);
    panel.update({ ...none, camera: { ...none.camera, selected: null } }, false);
    expect($<HTMLButtonElement>("calibrate").disabled).toBe(true);
    expect($("camera-reason").textContent).toBe("Choose a camera first");
    panel.update(null, false);
    expect($<HTMLButtonElement>("check-framing").disabled).toBe(true);
    expect($("camera-reason").textContent).toBe("The engine isn't running: start it with make dev");
  });

  it("disables what needs the camera while a scan runs, and says why (#173)", () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(AC410), true);
    for (const id of ["preview-toggle", "calibrate", "check-framing", "mask-draw"]) {
      expect($<HTMLButtonElement>(id).disabled, id).toBe(true);
      expect($(id).title, id).toBe("The scan is using the camera");
    }
    expect($("camera-reason").textContent).toBe("The scan is using the camera");
    expect($("mask-reason").textContent).toBe("The scan is using the camera"); // beside Skip an area, further down
    expect($<HTMLButtonElement>("mask-clear").disabled).toBe(false); // doesn't need the camera
    panel.update(status(AC410), false);
    for (const id of ["preview-toggle", "calibrate", "check-framing", "mask-draw"]) expect($<HTMLButtonElement>(id).disabled, id).toBe(false);
    expect($("mask-reason").hidden).toBe(true);
  });

  it("keeps a busy button disabled when status arrives while it runs", async () => {
    let finish!: (r: Response) => void;
    const { engine } = fakeEngine({ calibrate: () => new Promise<Response>((r) => { finish = r; }) });
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(AC410), false);
    $<HTMLButtonElement>("calibrate").click();
    panel.update(status(AC410), false); // e.g. the output window's stats, every 2 s
    expect($<HTMLButtonElement>("calibrate").disabled).toBe(true);
    finish(json({ exposure: 1200, gain: 3, p99: 201.4 }));
    await vi.waitFor(() => expect($<HTMLButtonElement>("calibrate").disabled).toBe(false));
  });

  it("saves a scan setting as it's changed", () => {
    const { engine, calls } = fakeEngine();
    mountCameraPanel({ engine, notice: () => {} });
    const hdr = $<HTMLSelectElement>("hdr");
    hdr.value = "3";
    hdr.dispatchEvent(new Event("change"));
    expect(calls).toContain('setScanSettings {"hdr":3}');
  });

  it("keeps one button name for both kinds of camera, and says a still camera was only checked (#172)", async () => {
    const { engine } = fakeEngine({ calibrate: async () => json({ exposure: 167, gain: 0, p99: 149, manual: true }) });
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(A6600), false);
    expect($("calibrate").textContent).toBe("Check exposure");
    expect($("hdr-row").hidden).toBe(false); // HDR: the camera's own bracketing
    $("calibrate").click();
    await vi.waitFor(() => expect($("exposure-note").textContent).toBe("Good: checked the exposure set on the camera; nothing changed on it"));
    panel.update(status(AC410), false);
    expect($("calibrate").textContent).toBe("Check exposure");
  });

  it("says what to change on a still camera when its exposure isn't right", async () => {
    const detail = "Too dark (white at 90 of 255; a still camera needs 120 to 249): use a slower shutter or a higher ISO on the camera.";
    const { engine } = fakeEngine({ calibrate: async () => json({ detail }, 422) });
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(A6600), false);
    $("calibrate").click();
    expect($("calibrate").textContent).toBe("Checking…");
    await vi.waitFor(() => expect($("exposure-note").textContent).toBe(detail)); // the engine's verdict first (#172)
    expect($("calibrate").textContent).toBe("Check exposure");
  });

  it("names the camera its scan settings belong to, each setting labeled and explained on screen (#172)", () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(A6600), false);
    expect($("scan-settings-camera").textContent).toBe("Scan settings for Sony Alpha-A6600");
    expect(document.querySelector("[data-fold=camera]")!.textContent).toContain("Before scanning");
    expect(document.querySelector("[data-fold=camera]")!.textContent!.match(/Used by the next scan/g)).toHaveLength(1);
    for (const id of ["aperture", "hdr", "hole-fill"]) {
      expect($<HTMLSelectElement>(id).labels?.[0]?.textContent?.trim(), id).toBeTruthy(); // visible, not only aria-label
    }
    for (const id of ["aperture", "hdr", "hole-fill", "mask-draw"]) {
      const hint = ($(id).getAttribute("aria-describedby") ?? "").split(/\s+/)
        .map((h) => document.getElementById(h)).find((h) => h?.classList.contains("hint"));
      expect(hint?.textContent?.length ?? 0, id).toBeGreaterThan(20);
      expect(hint!.closest("[hidden]"), id).toBeNull();
    }
    expect([...$<HTMLSelectElement>("hdr").options].map((o) => o.text)).not.toContain("HDR: off"); // the label says HDR
    panel.update(status(AC410), false);
    expect($("scan-settings-camera").textContent).toBe("Scan settings for Webcam AC410");
  });

  it("says drawn areas are skipped (#170)", async () => {
    const twoAreas = [[[0, 0], [0.2, 0], [0.2, 0.2]], [[0.5, 0.5], [0.7, 0.5], [0.7, 0.7]]];
    const { engine } = fakeEngine({ scanSettings: async () => json({ hole_fill: 9, hdr: 1, mask: twoAreas, aperture: "8" }) });
    const panel = mountCameraPanel({ engine, notice: () => {} });
    expect($("mask-draw").textContent).toBe("Skip an area");
    await panel.loadScanSettings();
    expect($("mask-note").textContent).toBe("Skipping 2 areas");
    expect($("mask-hint").textContent).toMatch(/leaves them out/); // on screen, not only a tooltip (#172)
  });

  it("removes one skipped area when it's clicked, keeping the others", async () => {
    const twoAreas = [[[0, 0], [0.2, 0], [0.2, 0.2]], [[0.5, 0.5], [0.7, 0.5], [0.7, 0.7]]];
    const { engine, calls } = fakeEngine({ scanSettings: async () => json({ hole_fill: 9, hdr: 1, mask: twoAreas, aperture: "8" }) });
    const panel = mountCameraPanel({ engine, notice: () => {} });
    await panel.loadScanSettings();
    document.querySelectorAll("#mask-overlay polygon")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toContain(`setScanSettings ${JSON.stringify({ mask: [twoAreas[1]] })}`);
  });

  it("shows the preview after a framing check, so its outline can be seen (#170)", async () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {}, fetchPreview: async () => new Response(new Blob(["x"])) });
    panel.update(status(AC410), false);
    expect($("preview-box").hidden).toBe(true);
    $("check-framing").click();
    await vi.waitFor(() => expect($("framing-note").hidden).toBe(false));
    expect($("preview-box").hidden).toBe(false);
    panel.stopPreview();
  });

  it("forgets the framing result when another camera is chosen", async () => {
    const { engine } = fakeEngine();
    const panel = mountCameraPanel({ engine, notice: () => {} });
    panel.update(status(AC410), false);
    $("check-framing").click();
    await vi.waitFor(() => expect($("framing-note").hidden).toBe(false));
    panel.update(status(A6600), false);
    expect($("framing-note").hidden).toBe(true);
    expect(document.querySelector("#framing-overlay polygon")!.getAttribute("points")).toBe("");
  });

  it("keeps the last framing result for the Setup checklist, and says when a check starts and ends (#168)", async () => {
    const { engine } = fakeEngine();
    const onChange = vi.fn();
    const panel = mountCameraPanel({ engine, notice: () => {}, onChange });
    panel.update(status(AC410), false);
    expect(panel.framing()).toBeNull();
    $("check-framing").click();
    expect(onChange).toHaveBeenCalledTimes(1); // busy: the checklist's button follows it
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(panel.framing()).toMatchObject({ span: 0.8, advice: null });
    $("calibrate").click();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(4));
    panel.update(status(A6600), false); // another camera: its framing is unknown
    expect(panel.framing()).toBeNull();
  });
});
