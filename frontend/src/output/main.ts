import { connect } from "../shared/connection";
import { shouldShowHint } from "./hint";
import { OutputRenderer } from "./renderer";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const hint = document.getElementById("hint")!;
const renderer = new OutputRenderer(canvas);
let size = renderer.resize();

const conn = connect({
  hello: () => ({ type: "hello", role: "output", ...size }),
  onMessage(msg) {
    if (msg.type === "show_test_frame") renderer.showTestFrame(msg.kind);
    if (msg.type === "show_pattern") {
      renderer.showPattern(msg.pattern);
      // Ack only once the frame has been composited: one rAF gets it drawn, the second
      // guarantees the previous frame was presented.
      requestAnimationFrame(() => requestAnimationFrame(() => conn.send({ type: "pattern_shown", seq: msg.seq })));
    }
  },
});

window.addEventListener("resize", () => {
  size = renderer.resize();
  conn.send({ type: "hello", role: "output", ...size });
  syncHint();
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
