import { connect } from "../shared/connection";
import type { StatusMessage, TestFrameKind } from "../shared/messages";
import { EFFECTS, effectById } from "../effects/index";
import type { SceneMessage } from "../shared/messages";
import { controlsFor, parseControlValue } from "./controls";
import { initialScan, scanLabel, scanReducer, type ScanState } from "./scanState";
import { cameraOptions, describeStatus } from "./statusView";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const banners = $("banners");
const projector = $("projector");
const output = $("output");
const cameras = $("cameras");
const scan = $<HTMLButtonElement>("scan");
const cameraSelect = $<HTMLSelectElement>("camera-select");
const calibration = $("calibration");
const preview = $<HTMLImageElement>("preview");
const previewToggle = $<HTMLButtonElement>("preview-toggle");
const calibrate = $<HTMLButtonElement>("calibrate");

let status: StatusMessage | null = null;
let scanState: ScanState = initialScan;
const scanImage = $<HTMLImageElement>("scan-image");
const scanView = $("scan-view");
const surfacesSvg = document.getElementById("surfaces") as unknown as SVGSVGElement;
const SVG_NS = "http://www.w3.org/2000/svg";
const stageEmpty = $("stage-empty");
const scanText = $("scan-label");

let scene: SceneMessage | null = null;
const effectErrors = new Map<number, { effect: string; log: string }>(); // surface id -> failing effect
const surfacePanel = $("surface-panel");
const surfaceTitle = $("surface-title");
const effectSelect = $<HTMLSelectElement>("effect-select");
const effectControls = $("effect-controls");
const effectError = $("effect-error");
effectSelect.replaceChildren(...EFFECTS.map((e) => Object.assign(document.createElement("option"), { value: e.id, textContent: e.name })));

const patchSurface = (id: number, body: object) =>
  void fetch(`/api/scene/surfaces/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const select = (id: number | null) =>
  void fetch("/api/scene/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });

function renderSurfaces() {
  const surfaces = scene?.surfaces ?? [];
  surfacesSvg.replaceChildren(
    ...surfaces.flatMap((s) => {
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", s.polygon.map(([x, y]) => `${x},${y}`).join(" "));
      poly.classList.toggle("selected", s.id === scene?.selected);
      poly.classList.toggle("error", effectErrors.has(s.id));
      poly.addEventListener("click", (ev) => {
        ev.stopPropagation();
        select(s.id === scene?.selected ? null : s.id);
      });
      const [x, y] = s.polygon[0];
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(x + 12));
      label.setAttribute("y", String(y + 34));
      label.textContent = String(s.id);
      return [poly, label];
    }),
  );
  renderPanel();
}

function renderPanel() {
  const surface = scene?.surfaces.find((s) => s.id === scene?.selected);
  surfacePanel.hidden = !surface;
  if (!surface) return;
  surfaceTitle.textContent = `Surface ${surface.id}`;
  effectSelect.value = surface.effect;
  const effect = effectById(surface.effect);
  // Don't rebuild controls under the user's cursor while they drag; only when the surface/effect changes.
  const key = `${surface.id}:${effect.id}`;
  if (effectControls.dataset.key !== key) {
    effectControls.dataset.key = key;
    effectControls.replaceChildren(
      ...controlsFor(effect, surface.params).map((c) => {
        const row = Object.assign(document.createElement("label"), { className: "control" });
        const input = Object.assign(document.createElement("input"), { type: c.kind, value: String(c.value) });
        if (c.kind === "range") Object.assign(input, { min: c.min, max: c.max, step: c.step });
        const readout = Object.assign(document.createElement("span"), { className: "muted", textContent: String(c.value) });
        input.addEventListener("input", () => {
          readout.textContent = input.value;
          patchSurface(surface.id, { params: { [c.name]: parseControlValue(c.kind, input.value) } });
        });
        row.append(Object.assign(document.createElement("span"), { textContent: c.label }), readout, input);
        return row;
      }),
    );
  }
  const log = effectErrors.get(surface.id)?.log;
  effectError.hidden = !log;
  effectError.textContent = log ? `Shader error:\n${log}` : "";
}

effectSelect.addEventListener("change", () => {
  if (scene?.selected != null) patchSurface(scene.selected, { effect: effectSelect.value });
});
surfacesSvg.addEventListener("click", () => select(null));

function renderScan() {
  scanText.textContent = scanLabel(scanState);
  if (scanState.image && scanImage.getAttribute("src") !== scanState.image) scanImage.src = scanState.image;
  scanView.hidden = !scanState.image;
  stageEmpty.hidden = !!scanState.image;
  if (scanState.size) {
    const { width, height } = scanState.size;
    scanView.style.aspectRatio = `${width} / ${height}`;
    surfacesSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  renderSurfaces();

  scan.textContent = scanState.running ? "Scanning…" : "Scan";
  if (scanState.running) scan.disabled = true;
}

function render() {
  const view = describeStatus(status);
  banners.replaceChildren(
    ...view.banners.map((text) => Object.assign(document.createElement("div"), { className: "banner", textContent: text })),
  );
  projector.textContent = view.projector;
  output.textContent = view.output;
  output.className = status?.output_connected ? "ok" : "bad";
  cameras.textContent = status?.hardware.cameras.join(", ") || "None";
  scan.disabled = !view.scanEnabled;
  calibration.textContent = view.calibration;
  cameraSelect.replaceChildren(
    ...cameraOptions(status).map((o) => Object.assign(document.createElement("option"), o)),
  );
  calibrate.disabled = !status?.output_connected || !status.camera.selected;
}

function notice(text: string) {
  const note = Object.assign(document.createElement("div"), { className: "banner", textContent: text });
  banners.append(note);
  setTimeout(() => note.remove(), 6000);
}

connect({
  hello: () => ({ type: "hello", role: "editor" }),
  onMessage(msg) {
    if (msg.type === "status") {
      status = msg;
      render();
      renderScan();
    } else if (msg.type === "scene") {
      scene = msg;
      // An error belongs to one effect; switching the surface to another effect clears it.
      for (const s of msg.surfaces) if (effectErrors.get(s.id)?.effect !== s.effect) effectErrors.delete(s.id);
      renderSurfaces();
    } else if (msg.type === "effect_error") {
      effectErrors.set(msg.surface, { effect: msg.effect, log: msg.log });
      renderSurfaces();
    } else if (msg.type.startsWith("scan_")) {
      scanState = scanReducer(scanState, msg as Parameters<typeof scanReducer>[1]);
      if (msg.type === "scan_failed") notice(`Scan failed: ${msg.error}`);
      renderScan();
    }
  },
  onOpenChange(open) {
    if (!open) {
      status = null;
      render();
    }
  },
});

$("open-output").addEventListener("click", () => window.open("/output.html", "auto-mapper-output", "popup,width=960,height=540"));
$("refresh").addEventListener("click", () => void fetch("/api/hardware/refresh", { method: "POST" }));
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-test-frame]")) {
  btn.addEventListener("click", () =>
    void fetch("/api/test-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: btn.dataset.testFrame as TestFrameKind }),
    }),
  );
}
scan.addEventListener("click", async () => {
  if (previewTimer !== undefined) previewToggle.click(); // the scan needs the camera to itself
  const res = await fetch("/api/scan", { method: "POST" });
  if (!res.ok) notice(`Cannot scan: ${(await res.json()).detail}`);
});
// Show the last scan, with its surfaces, after a reload.
void fetch("/api/scan/latest").then(async (r) => {
  if (r.ok) {
    scanState = scanReducer(scanState, { type: "scan_result", ...(await r.json()) });
    renderScan();
  }
});

cameraSelect.addEventListener("change", () =>
  void fetch("/api/camera", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unique_id: cameraSelect.value }),
  }),
);

// Preview is opt-in: polling keeps the camera running, so it only runs while shown.
let previewTimer: number | undefined;
previewToggle.addEventListener("click", () => {
  const on = previewTimer === undefined;
  preview.hidden = !on;
  previewToggle.textContent = on ? "Hide preview" : "Show preview";
  if (on) {
    const refresh = () => (preview.src = `/api/camera/preview.jpg?t=${Date.now()}`);
    refresh();
    previewTimer = window.setInterval(refresh, 500);
  } else {
    window.clearInterval(previewTimer);
    previewTimer = undefined;
    void fetch("/api/camera/release", { method: "POST" });
  }
});

calibrate.addEventListener("click", async () => {
  calibrate.disabled = true;
  calibrate.textContent = "Calibrating…";
  try {
    const res = await fetch("/api/camera/calibrate", { method: "POST" });
    const body = await res.json();
    notice(res.ok ? `Calibrated: exposure ${body.exposure}, white peak ${Math.round(body.p99)}` : `Calibration failed: ${body.detail}`);
  } finally {
    if (previewTimer === undefined) void fetch("/api/camera/release", { method: "POST" });
    calibrate.textContent = "Calibrate exposure";
    render();
  }
});
render();
