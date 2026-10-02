import { EFFECTS } from "../effects/index";
import { connect } from "../shared/connection";
import type { SceneMessage } from "../shared/messages";
import { bindPresentationKeys } from "../shared/presentation";
import { SceneRenderer } from "./sceneRenderer";
import { shouldShowHint } from "./hint";
import { OutputRenderer } from "./renderer";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const hint = document.getElementById("hint")!;
const renderer = new OutputRenderer(canvas);
let size = renderer.resize();

// "frames": test frames and scan patterns, drawn once. "scene": effects, animated.
let mode: "frames" | "scene" = "frames";
let scene: SceneMessage | null = null;
let raf = 0;
const sceneRenderer = new SceneRenderer(renderer.gl, EFFECTS, (e) => conn.send({ type: "effect_error", ...e }));
const started = performance.now();

let frames = 0;
let statsFrom = performance.now();
function loop() {
  sceneRenderer.draw((performance.now() - started) / 1000);
  frames++;
  const now = performance.now();
  if (now - statsFrom >= 2000) {
    // Let the editor see whether the projector keeps up (target: the display's 60 Hz).
    conn.send({ type: "output_stats", fps: (frames * 1000) / (now - statsFrom) });
    frames = 0;
    statsFrom = now;
  }
  raf = requestAnimationFrame(loop);
}

function showScene(msg: SceneMessage) {
  // A new scan brings new geometry; effect/param edits keep it. Reload the scan image only then.
  const geometry = (m: SceneMessage | null) => (m ? JSON.stringify(m.surfaces.map((s) => s.polygon)) : "");
  const changedScan = geometry(scene) !== geometry(msg);
  scene = msg;
  sceneRenderer.setScene(msg);
  if (changedScan) {
    const img = new Image();
    img.onload = () => sceneRenderer.setScanImage(img);
    img.src = `/api/scan/latest.png?t=${Date.now()}`;
  }
  if (mode !== "scene") {
    mode = "scene";
    raf = requestAnimationFrame(loop);
  }
}

function showFrames() {
  mode = "frames";
  cancelAnimationFrame(raf);
}

const conn = connect({
  hello: () => ({ type: "hello", role: "output", ...size }),
  onMessage(msg) {
    if (msg.type === "scene") showScene(msg);
    if (msg.type === "show_test_frame") {
      showFrames();
      renderer.showTestFrame(msg.kind);
    }
    if (msg.type === "show_pattern") {
      showFrames();
      renderer.showPattern(msg.pattern);
      // Ack only once the frame has been composited: one rAF gets it drawn, the second
      // guarantees the previous frame was presented.
      requestAnimationFrame(() => requestAnimationFrame(() => conn.send({ type: "pattern_shown", seq: msg.seq })));
    }
  },
});

window.addEventListener("resize", () => {
  size = renderer.resize(mode === "frames");
  conn.send({ type: "hello", role: "output", ...size });
  syncHint();
bindPresentationKeys(() => scene?.presentation.mode ?? "edit");
});

// Browsers only allow fullscreen from a user gesture, so the engine can't do it for us.
function syncHint() {
  hint.hidden = !shouldShowHint({
    pageFullscreen: document.fullscreenElement !== null,
    window: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
  });
}
document.addEventListener("fullscreenchange", syncHint);
document.addEventListener("click", () => {
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
});
syncHint();
bindPresentationKeys(() => scene?.presentation.mode ?? "edit");
