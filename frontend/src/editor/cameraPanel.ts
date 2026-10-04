// The Camera section (#146): the preview, calibration, the framing check, and the selected camera's
// scan settings (hole fill, HDR, aperture, mask). Mounted on the Editor's markup; main.ts passes it
// each status and asks it to stop the preview before a scan.

import type { CalibrateResponse, ScanSettingsResponse, StatusMessage } from "../shared/messages";
import { drawStep, idleDraw, type DrawEvent } from "./drawing";
import type { EngineClient } from "./engineClient";
import { describeFraming, type FramingResult } from "./framingView";
import { previewStep } from "./preview";
import { describeStatus } from "./statusView";

const SVG_NS = "http://www.w3.org/2000/svg";
const PREVIEW_EVERY_MS = 500;

export interface CameraPanelDeps {
  engine: EngineClient;
  notice: (text: string) => void;
  fetchPreview?: () => Promise<Response>;
}

export interface CameraPanel {
  update(status: StatusMessage | null, scanning: boolean): void;
  loadScanSettings(): Promise<void>;
  stopPreview(): void; // e.g. before a scan: it needs the camera to itself
  previewRunning(): boolean;
}

export function mountCameraPanel(deps: CameraPanelDeps): CameraPanel {
  const { engine, notice } = deps;
  const fetchPreview = deps.fetchPreview ?? (() => fetch(`/api/camera/preview.jpg?t=${Date.now()}`));
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let status: StatusMessage | null = null;
  let scanning = false;

  // ---- Scan settings for the selected camera (#66): saved per camera, used by the next scan.
  const holeFill = $<HTMLInputElement>("hole-fill");
  const holeFillReadout = $("hole-fill-readout");
  const hdrSelect = $<HTMLSelectElement>("hdr");
  const apertureRow = $("aperture-row");
  const apertureSelect = $<HTMLSelectElement>("aperture");
  let cameraMask: number[][][] | null = null; // 0..1 camera coordinates

  async function loadScanSettings() {
    const r = await engine.scanSettings();
    if (!r.ok) return;
    const s = (await r.json()) as ScanSettingsResponse;
    cameraMask = s.mask;
    renderMask();
    if (document.activeElement !== hdrSelect) hdrSelect.value = String(s.hdr);
    if (document.activeElement !== apertureSelect) apertureSelect.value = s.aperture;
    if (document.activeElement === holeFill) return;
    holeFill.value = String(s.hole_fill);
    holeFillReadout.textContent = `${s.hole_fill} px`;
  }
  apertureSelect.addEventListener("change", () => void engine.setScanSettings({ aperture: apertureSelect.value }));
  hdrSelect.addEventListener("change", () => void engine.setScanSettings({ hdr: Number(hdrSelect.value) }));
  holeFill.addEventListener("input", () => { holeFillReadout.textContent = `${holeFill.value} px`; });
  holeFill.addEventListener("change", () => void engine.setScanSettings({ hole_fill: Number(holeFill.value) }));

  // ---- Skipped areas (#66, #170): click corners on the preview around what the scan should leave out
  // (a window, a TV, shiny things); click a shaded area to stop skipping it.
  const previewBox = $("preview-box");
  const maskOverlay = $("mask-overlay");
  let maskDraw = idleDraw; // in preview pixels, so the double-click echo rule works; saved as 0..1
  function renderMask() {
    const { width, height } = previewBox.getBoundingClientRect();
    const toUnit = (p: number[]) => `${p[0] / Math.max(1, width)},${p[1] / Math.max(1, height)}`;
    const shapes: SVGElement[] = (cameraMask ?? []).map((poly, i) => {
      const el = document.createElementNS(SVG_NS, "polygon");
      el.setAttribute("points", poly.map(([x, y]) => `${x},${y}`).join(" "));
      el.addEventListener("click", (ev) => {
        if (maskDraw.active) return; // drawing: the click places a corner
        ev.stopPropagation();
        const rest = (cameraMask ?? []).filter((_, j) => j !== i);
        void engine.setScanSettings(rest.length ? { mask: rest } : { clear_mask: true }).then(() => loadScanSettings());
      });
      return el;
    });
    if (maskDraw.active && maskDraw.points.length) {
      const draft = document.createElementNS(SVG_NS, "polyline");
      draft.setAttribute("points", maskDraw.points.map(toUnit).join(" "));
      shapes.push(draft);
    }
    maskOverlay.replaceChildren(...shapes);
    previewBox.classList.toggle("drawing", maskDraw.active);
    $("mask-draw").textContent = maskDraw.active ? "Double-click to finish" : "Skip an area";
    $("mask-clear").hidden = !cameraMask;
    $("mask-note").textContent = maskDraw.active ? "Click corners on the preview around what to skip"
      : cameraMask ? `Skipping ${cameraMask.length} area${cameraMask.length > 1 ? "s" : ""}` : "";
  }
  function maskStep(ev: DrawEvent) {
    maskDraw = drawStep(maskDraw, ev);
    if (maskDraw.finished) {
      const { width, height } = previewBox.getBoundingClientRect();
      const unit = maskDraw.finished.map(([x, y]) => [
        Math.min(1, Math.max(0, x / width)), Math.min(1, Math.max(0, y / height)),
      ]);
      maskDraw = idleDraw;
      void engine.setScanSettings({ mask: [...(cameraMask ?? []), unit] }).then(() => loadScanSettings());
    }
    renderMask();
  }
  const previewPoint = (ev: MouseEvent) => {
    const r = previewBox.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  $("mask-draw").addEventListener("click", () => {
    if (maskDraw.active) return maskStep({ type: "finish" });
    if (!previewRunning()) togglePreview(); // you draw on what the camera sees
    maskStep({ type: "start" });
  });
  $("mask-clear").addEventListener("click", () => void engine.setScanSettings({ clear_mask: true }).then(() => loadScanSettings()));
  previewBox.addEventListener("click", (ev) => { if (maskDraw.active) maskStep({ type: "point", point: previewPoint(ev) }); });
  previewBox.addEventListener("dblclick", () => { if (maskDraw.active) maskStep({ type: "finish" }); });
  window.addEventListener("keydown", (ev) => {
    if (!maskDraw.active) return;
    if (ev.key === "Enter") maskStep({ type: "finish" });
    if (ev.key === "Escape") maskStep({ type: "cancel" });
  });

  // ---- Preview: opt-in, since polling keeps the camera running. One request at a time (a still
  // camera takes seconds per photo); the last good photo stays up, with the engine's reason when none.
  const preview = $<HTMLImageElement>("preview");
  const previewToggle = $<HTMLButtonElement>("preview-toggle");
  const previewNote = $("preview-note");
  let previewTimer: number | undefined; // set while the preview runs (the next update's timeout)
  let previewUrl: string | null = null;
  const previewRunning = () => previewTimer !== undefined;
  async function previewLoop() {
    const update = await previewStep(fetchPreview);
    if (!previewRunning()) return; // hidden meanwhile
    if (update.photo) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(update.photo);
      preview.src = previewUrl;
    }
    previewNote.textContent = update.note;
    previewTimer = window.setTimeout(() => void previewLoop(), PREVIEW_EVERY_MS);
  }
  function togglePreview() {
    const on = !previewRunning();
    previewBox.hidden = !on;
    previewToggle.textContent = on ? "Hide preview" : "Show preview";
    if (on) {
      previewTimer = window.setTimeout(() => void previewLoop(), 0);
    } else {
      window.clearTimeout(previewTimer);
      previewTimer = undefined;
      previewNote.textContent = "";
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      void engine.releaseCamera();
    }
  }
  previewToggle.addEventListener("click", togglePreview);

  // ---- Calibration and the framing check: each takes the camera, then lets it go unless previewing.
  const calibrate = $<HTMLButtonElement>("calibrate");
  const checkFraming = $<HTMLButtonElement>("check-framing");
  const framingNote = $("framing-note");
  async function usingCamera(button: HTMLButtonElement, busyLabel: string, run: () => Promise<void>) {
    const label = button.textContent;
    button.disabled = true;
    button.dataset.busy = "1"; // render leaves its label alone meanwhile
    button.textContent = busyLabel;
    try {
      await run();
    } finally {
      if (!previewRunning()) void engine.releaseCamera();
      delete button.dataset.busy;
      button.textContent = label;
      render();
    }
  }
  calibrate.addEventListener("click", () => {
    const checking = calibrate.textContent === "Check exposure"; // a still camera: its own exposure, checked
    void usingCamera(calibrate, checking ? "Checking…" : "Calibrating…", async () => {
      const res = await engine.calibrate();
      const body = await res.json();
      if (!res.ok) return notice(`${checking ? "Exposure check" : "Calibration"} failed: ${body.detail}`);
      const c = body as CalibrateResponse;
      notice(checking ? `Exposure is good: white peak ${Math.round(c.p99)}` : `Calibrated: exposure ${c.exposure}, white peak ${Math.round(c.p99)}`);
    });
  });
  checkFraming.addEventListener("click", () => void usingCamera(checkFraming, "Checking…", async () => {
    const res = await engine.checkFraming();
    const body = await res.json();
    if (!res.ok) return notice(`Framing check failed: ${body.detail}`);
    const view = describeFraming(body as FramingResult);
    framingNote.textContent = view.text;
    framingNote.classList.toggle("warn", view.warn);
    framingNote.hidden = false;
    document.querySelector("#framing-overlay polygon")!.setAttribute("points", view.points);
    if (!previewRunning()) togglePreview(); // the outline is drawn on the preview (#170)
  }));

  // ---- What status says about the camera.
  const calibration = $("calibration");
  const battery = $("battery");
  const batteryLabel = $("battery-label");
  function render() {
    const view = describeStatus(status);
    calibration.textContent = view.calibration;
    battery.textContent = view.battery?.replace("Battery ", "") ?? "";
    battery.hidden = batteryLabel.hidden = view.battery === null;
    calibrate.disabled = !status?.output_connected || !status.camera.selected;
    checkFraming.disabled = calibrate.disabled || scanning;
    const sel = status?.hardware.cameras.find((c) => c.unique_id === status?.camera.selected);
    const still = sel?.device_type === "still";
    apertureRow.hidden = !still; // a webcam's lens has none to set
    // A still camera's exposure is set on it (the a6600 takes one exposure change over USB): the
    // engine checks it rather than calibrating. Its HDR is its own bracketing (3 photos per press).
    if (!calibrate.dataset.busy) calibrate.textContent = still ? "Check exposure" : "Calibrate exposure";
  }

  return {
    update(next, isScanning) {
      if (next?.camera.selected !== status?.camera.selected) { // another camera: its framing is unknown
        framingNote.hidden = true;
        document.querySelector("#framing-overlay polygon")!.setAttribute("points", "");
      }
      status = next;
      scanning = isScanning;
      render();
    },
    loadScanSettings,
    stopPreview: () => { if (previewRunning()) togglePreview(); },
    previewRunning,
  };
}
