import { connect } from "../shared/connection";
import type { StatusMessage, TestFrameKind } from "../shared/messages";
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
// Placeholder until the scan pipeline lands (#4); a silent enabled button is misleading.
scan.addEventListener("click", () => notice("Scanning is not built yet (issue #4). The button shows when the rig is ready."));

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
