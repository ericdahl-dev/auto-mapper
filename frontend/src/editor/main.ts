import { connect } from "../shared/connection";
import type { StatusMessage, TestFrameKind } from "../shared/messages";
import { describeStatus } from "./statusView";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const banners = $("banners");
const projector = $("projector");
const output = $("output");
const cameras = $("cameras");
const scan = $<HTMLButtonElement>("scan");

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
scan.addEventListener("click", () => {
  const note = Object.assign(document.createElement("div"), {
    className: "banner",
    textContent: "Scanning is not built yet (issue #4). The button shows when the rig is ready.",
  });
  banners.append(note);
  setTimeout(() => note.remove(), 5000);
});
render();
