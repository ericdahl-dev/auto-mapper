import { connect } from "../shared/connection";
import { OutputRenderer } from "./renderer";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const hint = document.getElementById("hint")!;
const renderer = new OutputRenderer(canvas);
let size = renderer.resize();

const conn = connect({
  hello: () => ({ type: "hello", role: "output", ...size }),
  onMessage(msg) {
    if (msg.type === "show_test_frame") renderer.showTestFrame(msg.kind);
  },
});

window.addEventListener("resize", () => {
  size = renderer.resize();
  conn.send({ type: "hello", role: "output", ...size });
});

// Browsers only allow fullscreen from a user gesture, so the engine can't do it for us.
const syncHint = () => (hint.hidden = document.fullscreenElement !== null);
document.addEventListener("fullscreenchange", syncHint);
document.addEventListener("click", () => {
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
});
syncHint();
