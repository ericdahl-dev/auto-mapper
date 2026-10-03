import { offsetPolygon } from "../shared/geometry";
import { connect } from "../shared/connection";
import type { StatusMessage, TestFrameKind } from "../shared/messages";
import { EFFECTS, effectById } from "../effects/index";
import type { ShowMessage } from "../shared/messages";
import { bindPresentationKeys, setMode, stepScene, toggleBlackout } from "../shared/presentation";
import { applyPlan } from "./applyEffect";
import { controlsFor, mediaLabel, parseControlValue } from "./controls";
import { type Bezier, curveBezierEdge, flatten, fromPolygon, insertAnchor, moveAnchor, moveControl, removeAnchor } from "./bezier";
import { handleIndices, moveOnRun, nearestEdge } from "./curves";
import { drawStep, idleDraw, type DrawEvent } from "./drawing";
import { insertVertex, removeVertex, toProjector } from "./polygonEdit";
import { initialScan, scanLabel, scanReducer, type ScanState } from "./scanState";
import { EditSession, type SurfaceEdit } from "./editSession";
import { createEngineClient, type Schedule } from "./engineClient";
import { framingOf, panAfterDrag, zoomAfterWheel } from "./framing";
import { trackPointer } from "./gesture";
import { movePin, pinHandles } from "./pin";
import { ACTIONS, MidiRouter, parseMidi, settingValue, targetMenu, type MidiTarget, type TargetItem } from "./midi";
import { deleteKeyTargets } from "./deleteKey";
import { foldOpen, problemFolds } from "./folds";
import { moveScene } from "./sceneList";
import { FIT, panBy, type View, zoomAt } from "./viewZoom";
import { nextChangeText } from "./scheduleView";
import { bindUndoKeys } from "./undoKeys";
import { placeOutput } from "./screens";
import { channelNote, describeSound } from "./soundView";
import { cameraOptions, describeStatus, projectorOptions } from "./statusView";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const banners = $("banners");
const projectorSelect = $<HTMLSelectElement>("projector-select");
const output = $("output");
const scan = $<HTMLButtonElement>("scan");
const cameraSelect = $<HTMLSelectElement>("camera-select");
const calibration = $("calibration");
const preview = $<HTMLImageElement>("preview");
const previewToggle = $<HTMLButtonElement>("preview-toggle");
const calibrate = $<HTMLButtonElement>("calibrate");

let status: StatusMessage | null = null;
const projectName = $("project-name");
const projectSaveName = $<HTMLInputElement>("project-save-name");
const projectSave = $<HTMLButtonElement>("project-save");
const projectList = $("project-list");

// New project: clears the scan and show to start over; saved projects are kept. Two clicks, so a
// stray one doesn't wipe the work.
const newProject = $<HTMLButtonElement>("project-new");
let newArmed: ReturnType<typeof setTimeout> | null = null;
newProject.addEventListener("click", async () => {
  if (!newArmed) {
    newProject.textContent = "Clear everything?";
    newProject.classList.add("on");
    newArmed = setTimeout(() => {
      newArmed = null;
      newProject.textContent = "New";
      newProject.classList.remove("on");
    }, 4000);
    return;
  }
  clearTimeout(newArmed);
  newArmed = null;
  const r = await engine.newProject();
  if (!r.ok) notice(r.status === 409 ? "Wait for the scan to finish, or cancel it." : "Couldn't start a new project.");
});

async function refreshProjects() {
  const res = await engine.projects();
  if (!res.ok) return;
  const projects: { name: string; slug: string; surfaces: number; saved_at: number }[] = await res.json();
  projectList.replaceChildren(
    ...projects.map((p) => {
      const li = document.createElement("li");
      li.classList.toggle("active", p.slug === status?.project?.slug);
      const when = new Date(p.saved_at * 1000).toLocaleString();
      li.append(
        Object.assign(document.createElement("span"), { textContent: p.name, title: `${p.surfaces} surfaces, saved ${when}` }),
        Object.assign(document.createElement("button"), {
          textContent: "Open",
          onclick: async () => {
            const r = await engine.openProject(p.slug);
            if (!r.ok) notice(`Cannot open: ${(await r.json()).detail}`);
          },
        }),
      );
      return li;
    }),
  );
}

async function reloadScan() {
  if (view !== FIT) setView(FIT); // a different scan: start from the whole of it
  const r = await engine.latestScan();
  if (r.ok) {
    scanState = scanReducer(initialScan, { type: "scan_result", ...(await r.json()) });
    renderScan();
  }
}
let scanState: ScanState = initialScan;
const scanImage = $<HTMLImageElement>("scan-image");
const scanView = $("scan-view");
const surfacesSvg = document.getElementById("surfaces") as unknown as SVGSVGElement;
const SVG_NS = "http://www.w3.org/2000/svg";
const stageEmpty = $("stage-empty");
const scanText = $("scan-label");

let show: ShowMessage | null = null;
const effectErrors = new Map<number, { effect: string; log: string }>(); // surface id -> failing effect
const surfacePanel = $("surface-panel");
const surfaceTitle = $("surface-title");
const effectSelect = $<HTMLSelectElement>("effect-select");
const effectControls = $("effect-controls");
const effectError = $("effect-error");
effectSelect.replaceChildren(...EFFECTS.map((e) => Object.assign(document.createElement("option"), { value: e.id, textContent: e.name })));

// The engine, and this Editor's view of the current show (see editSession.ts): edits show at once and
// save at most once per frame; show updates that arrive during a drag wait until it ends.
const engine = createEngineClient();
const session = new EditSession({ patch: (id, body, gesture) => void engine.patchSurface(id, body, gesture) });
/** Edits the shape or settings of a surface (shown at once, saved throttled). */
const patchSurface = (id: number, body: SurfaceEdit) => session.edit(id, body);
/** Shows the session's latest view (local edits included). */
function refresh() {
  show = session.view();
  renderSurfaces();
}
const surfaceName = $<HTMLInputElement>("surface-name");
const surfaceEdge = $<HTMLInputElement>("surface-edge");
const surfaceEdgeReadout = $("surface-edge-readout");
surfaceEdge.addEventListener("input", () => {
  if (show?.selected == null) return;
  patchSurface(show.selected, { edge: Number(surfaceEdge.value) }); // shown at once, saved once per frame
  refresh();
});
const deleteButton = $<HTMLButtonElement>("delete-surface");
const mergeButton = $<HTMLButtonElement>("merge-surfaces");
const applyButton = $<HTMLButtonElement>("apply-effect");
const multi = new Set<number>(); // shift-click selection for merging

// Zooming the scan view to place points precisely (viewZoom.ts). The view is a CSS transform, and
// projectorPoint and the handle sizes read the transformed box, so editing works the same zoomed.
let view: View = FIT;
const viewBox = () => ({ width: scanView.offsetWidth, height: scanView.offsetHeight }); // unzoomed
function setView(v: View) {
  view = v;
  scanView.style.transform = v.scale === 1 ? "" : `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  $("zoom-readout").textContent = `${Math.round(v.scale * 100)}%`;
  renderSurfaces(); // handles keep their size on screen
}
/** A pointer position in the unzoomed stage, in screen pixels. */
function stagePoint(ev: { clientX: number; clientY: number }): number[] {
  const r = scanView.getBoundingClientRect();
  return [ev.clientX - (r.left - view.x), ev.clientY - (r.top - view.y)];
}
const stage = scanView.parentElement!;
stage.addEventListener("wheel", (ev) => {
  if (scanView.hidden) return;
  if (ev.ctrlKey || ev.metaKey) { // pinch on a trackpad, or Cmd/Ctrl + scroll
    ev.preventDefault();
    ev.stopPropagation();
    setView(zoomAt(view, stagePoint(ev), Math.exp(-ev.deltaY * 0.01), viewBox()));
  } else if (view.scale > 1 && !(ev.target as Element).closest?.("[data-framing]")) {
    ev.preventDefault(); // two-finger scroll moves around a zoomed scan
    setView(panBy(view, [-ev.deltaX, -ev.deltaY], viewBox()));
  }
}, { passive: false, capture: true });
const centerOfStage = () => [scanView.offsetWidth / 2, scanView.offsetHeight / 2];
$("zoom-in").addEventListener("click", () => setView(zoomAt(view, centerOfStage(), 2, viewBox())));
$("zoom-out").addEventListener("click", () => setView(zoomAt(view, centerOfStage(), 0.5, viewBox())));
$("zoom-fit").addEventListener("click", () => setView(FIT));

function projectorPoint(ev: MouseEvent): number[] {
  const r = surfacesSvg.getBoundingClientRect();
  return toProjector(r, scanState.size ?? { width: show!.width, height: show!.height }, ev.clientX, ev.clientY);
}

/** Saves a Bezier outline: the engine stores it with its flattened polygon. */
const patchBezier = (id: number, bezier: Bezier) => patchSurface(id, { polygon: flatten(bezier), bezier });

const select = (id: number | null) => void engine.select(id);

// --- Making an edge bendable -------------------------------------------------
const curveButton = $<HTMLButtonElement>("curve-edge");
let curving = false;
function setCurving(on: boolean) {
  curving = on;
  curveButton.classList.toggle("on", on);
  surfacesSvg.classList.toggle("drawing", on);
}
curveButton.addEventListener("click", () => setCurving(!curving));

// --- Drawing surfaces by hand -------------------------------------------------
let draw = idleDraw;
const drawButton = $<HTMLButtonElement>("draw");
const redetectButton = $<HTMLButtonElement>("redetect");
const SOURCE_TEXT: Record<string, string> = {
  detected: "Detected automatically",
  edited: "Detected, then edited by you (kept on redetect)",
  drawn: "Drawn by you (kept on redetect)",
};

function drawEvent(ev: DrawEvent) {
  draw = drawStep(draw, ev);
  if (draw.finished) {
    void engine.addSurface(draw.finished);
    draw = idleDraw;
  }
  drawButton.classList.toggle("on", draw.active);
  surfacesSvg.classList.toggle("drawing", draw.active);
  renderSurfaces();
}

drawButton.addEventListener("click", () => drawEvent({ type: draw.active ? "cancel" : "start" }));
// Capture phase: in curve mode, a click picks the edge to make bendable.
surfacesSvg.addEventListener("click", (ev) => {
  if (!curving) return;
  ev.stopPropagation();
  const surface = show?.surfaces.find((x) => x.id === show?.selected);
  if (surface) {
    const bezier = surface.bezier ?? fromPolygon(surface.polygon);
    const edge = nearestEdge(bezier.anchors, projectorPoint(ev));
    patchBezier(surface.id, curveBezierEdge(bezier, edge));
  }
  setCurving(false);
}, true);
// Capture phase: while drawing, clicks place corners instead of selecting surfaces.
surfacesSvg.addEventListener("click", (ev) => {
  if (!draw.active) return;
  ev.stopPropagation();
  drawEvent({ type: "point", point: projectorPoint(ev) });
}, true);
surfacesSvg.addEventListener("dblclick", (ev) => {
  if (!draw.active) return;
  ev.stopPropagation();
  drawEvent({ type: "finish" });
}, true);
window.addEventListener("keydown", (ev) => {
  if (curving && ev.key === "Escape") setCurving(false);
  if (!draw.active) return;
  if (ev.key === "Enter") drawEvent({ type: "finish" });
  if (ev.key === "Escape") drawEvent({ type: "cancel" });
});
redetectButton.addEventListener("click", async () => {
  const r = await engine.redetect();
  notice(r.ok ? "Surfaces detected again. Drawn and edited surfaces were kept." : `Cannot redetect: ${(await r.json()).detail}`);
});

function draftElements(): SVGElement[] {
  if (!draw.active || draw.points.length === 0) return [];
  const line = document.createElementNS(SVG_NS, "polyline");
  line.classList.add("draft");
  line.setAttribute("points", draw.points.map(([x, y]) => `${x},${y}`).join(" "));
  const r = (4 * (show?.width ?? 1920)) / Math.max(1, surfacesSvg.getBoundingClientRect().width);
  const dots = draw.points.map(([x, y]) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.classList.add("draft");
    Object.entries({ cx: x, cy: y, r }).forEach(([k, v]) => c.setAttribute(k, String(v)));
    return c;
  });
  return [line, ...dots];
}

function renderSurfaces() {
  const surfaces = show?.surfaces ?? [];
  const width = show?.width ?? 1920;
  // Handle size in projector pixels that looks ~7 screen px whatever the editor's scale.
  const r = (7 * width) / Math.max(1, surfacesSvg.getBoundingClientRect().width);
  surfacesSvg.replaceChildren(
    ...surfaces.flatMap((s) => {
      const { bezier, polygon } = s; // the session's view already includes edits in progress
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", polygon.map(([x, y]) => `${x},${y}`).join(" "));
      poly.classList.toggle("selected", s.id === show?.selected);
      poly.classList.toggle("multi", multi.has(s.id));
      poly.classList.toggle("error", effectErrors.has(s.id));
      if (s.id === show?.selected && framingOf(effectById(s.effect))) bindFraming(poly, s);
      poly.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (framedJustNow) {
          framedJustNow = false; // the click that ends a framing drag isn't a selection click
          return;
        }
        if (ev.shiftKey) {
          multi.has(s.id) ? multi.delete(s.id) : multi.add(s.id);
          if (show?.selected != null) multi.add(show.selected);
          renderSurfaces();
          return;
        }
        multi.clear();
        select(s.id === show?.selected ? null : s.id);
      });
      poly.addEventListener("dblclick", (ev) => {
        if (s.id !== show?.selected) return;
        ev.stopPropagation();
        if (s.bezier) patchBezier(s.id, insertAnchor(s.bezier, projectorPoint(ev)));
        else patchSurface(s.id, { polygon: insertVertex(s.polygon, projectorPoint(ev)) });
      });
      const [x, y] = polygon[0];
      const label = document.createElementNS(SVG_NS, "text");
      // Same size on screen however far the view is zoomed in, so labels don't cover what you're editing.
      label.setAttribute("x", String(x + 12 / view.scale));
      label.setAttribute("y", String(y + 34 / view.scale));
      label.style.fontSize = `${28 / view.scale}px`;
      label.style.strokeWidth = `${4 / view.scale}px`;
      label.textContent = String(s.id);
      const parts: SVGElement[] = [poly, label];
      if (s.id === show?.selected && s.edge) {
        // The lit area when the edge is grown or shrunk, drawn faintly next to the real outline.
        const lit = document.createElementNS(SVG_NS, "polygon");
        lit.classList.add("edge");
        lit.setAttribute("points", offsetPolygon(polygon, s.edge).map(([x, y]) => `${x},${y}`).join(" "));
        parts.push(lit);
      }
      if (s.id === show?.selected && bezier) {
        parts.push(...bezierHandles(s.id, bezier, r));
      } else if (s.id === show?.selected) {
        // Handles on corners and a few along curves; a curve isn't dozens of tiny handles.
        handleIndices(polygon).forEach((index) => {
          const [hx, hy] = polygon[index];
          const handle = document.createElementNS(SVG_NS, "circle");
          handle.classList.add("handle");
          handle.setAttribute("cx", String(hx));
          handle.setAttribute("cy", String(hy));
          handle.setAttribute("r", String(r));
          handle.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (ev.altKey) patchSurface(s.id, { polygon: removeVertex(s.polygon, index) });
          });
          handle.addEventListener("pointerdown", (ev) => {
            if (ev.altKey) return;
            ev.stopPropagation();
            session.begin();
            // Follow the pointer at the window: redraws replace this handle on every move.
            trackPointer(ev.pointerId, (move) => {
              const current = session.surface(s.id)!.polygon;
              patchSurface(s.id, { polygon: moveOnRun(current, index, projectorPoint(move)) });
              refresh();
            }, () => {
              session.end();
              refresh();
            });
          });
          parts.push(handle);
        });
      }
      return parts;
    }),
    ...pinElements(r),
    ...alignElements(r),
    ...draftElements(),
  );
  renderPanel();
  renderPresentation();
  renderAlignment();
  renderHistory();
  renderScenes();
  renderMidi();
}

// Framing media by hand: drag inside the selected surface to pan, scroll to zoom.
let framedJustNow = false;
function bindFraming(poly: SVGPolygonElement, s: ShowMessage["surfaces"][number]) {
  poly.dataset.framing = "1"; // its scroll frames the media; the view zoom leaves it alone
  const effect = effectById(s.effect);
  const f = framingOf(effect)!; // which of the effect's settings are zoom and pan
  // Always read the latest values (local edits included), so fast scrolls build on each other.
  const num = (name: string, fallback: number) => {
    const v = session.surface(s.id)?.params[name];
    return typeof v === "number" ? v : fallback;
  };
  let drag: { start: number[]; moved: boolean; pan: { panX: number; panY: number } } | null = null;
  poly.addEventListener("pointerdown", (ev) => {
    if (ev.altKey || ev.shiftKey || ev.button !== 0) return;
    drag = { start: projectorPoint(ev), moved: false, pan: { panX: num(f.panX, 0), panY: num(f.panY, 0) } };
    session.begin();
    trackPointer(ev.pointerId, (move) => panTo(move), () => {
      if (!drag) return;
      framedJustNow = drag.moved;
      drag = null;
      session.end();
      refresh();
    });
  });
  const panTo = (ev: PointerEvent) => {
    if (!drag) return;
    const p = projectorPoint(ev);
    const delta = [p[0] - drag.start[0], p[1] - drag.start[1]];
    if (!drag.moved && Math.hypot(delta[0], delta[1]) < 4) return; // still a click
    drag.moved = true;
    const pan = panAfterDrag(effect, drag.pan, delta, s.polygon);
    patchSurface(s.id, { params: { [f.panX]: pan.panX, [f.panY]: pan.panY } });
    refresh();
  };
  poly.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    patchSurface(s.id, { params: { [f.zoom]: zoomAfterWheel(effect, num(f.zoom, 1), ev.deltaY) } });
  }, { passive: false });
}


/** Orange diamonds (and a dashed quad) for the selected surface's corner pin, when its effect uses one.
 *  Drag a corner to pin it; Alt-click any corner to go back to the outline's own corners. */
function pinElements(r: number): SVGElement[] {
  const s = show?.surfaces.find((x) => x.id === show?.selected);
  if (!s) return [];
  const pin = pinHandles(effectById(s.effect), s.params, s.polygon);
  if (!pin) return [];
  const corners = pin.corners; // the session's view already includes a drag in progress
  const quad = document.createElementNS(SVG_NS, "polygon");
  quad.classList.add("pin");
  quad.setAttribute("points", corners.map(([x, y]) => `${x},${y}`).join(" "));
  const handles = corners.map(([x, y], index) => {
    const d = document.createElementNS(SVG_NS, "rect");
    d.classList.add("handle", "pin");
    Object.entries({ x: x - r, y: y - r, width: 2 * r, height: 2 * r, transform: `rotate(45 ${x} ${y})` })
      .forEach(([k, v]) => d.setAttribute(k, String(v)));
    d.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (ev.altKey) patchSurface(s.id, { params: { [pin.name]: null } });
    });
    d.addEventListener("pointerdown", (ev) => {
      if (ev.altKey) return;
      ev.stopPropagation();
      session.begin();
      trackPointer(ev.pointerId, (move) => {
        const latest = pinHandles(effectById(s.effect), session.surface(s.id)!.params, s.polygon)!;
        patchSurface(s.id, { params: { [pin.name]: movePin(latest.corners, index, projectorPoint(move)) } });
        refresh();
      }, () => {
        session.end();
        refresh();
      });
    });
    return d;
  });
  return [quad, ...handles];
}

/** Anchor squares, control circles and tangent lines for a Bezier outline. */
function bezierHandles(id: number, bezier: Bezier, r: number): SVGElement[] {
  const n = bezier.anchors.length;
  const out: SVGElement[] = [];
  const line = (a: number[], b: number[]) => {
    const l = document.createElementNS(SVG_NS, "line");
    l.classList.add("tangent");
    Object.entries({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }).forEach(([k, v]) => l.setAttribute(k, String(v)));
    return l;
  };
  // Drag a handle: `update` computes the new Bezier from the pointer position.
  const draggable = (el: SVGElement, update: (b: Bezier, p: number[]) => Bezier) => {
    el.addEventListener("pointerdown", (ev) => {
      if ((ev as PointerEvent).altKey) return;
      ev.stopPropagation();
      session.begin();
      trackPointer((ev as PointerEvent).pointerId, (move) => {
        const latest = session.surface(id)?.bezier ?? bezier;
        patchBezier(id, update(latest, projectorPoint(move)));
        refresh();
      }, () => {
        session.end();
        refresh();
      });
    });
  };
  Object.entries(bezier.controls).forEach(([key, [c1, c2]]) => {
    const edge = Number(key);
    const a = bezier.anchors[edge];
    const b = bezier.anchors[(edge + 1) % n];
    out.push(line(a, c1), line(b, c2));
    ([c1, c2] as number[][]).forEach((c, which) => {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.classList.add("handle", "control");
      Object.entries({ cx: c[0], cy: c[1], r: r * 0.8 }).forEach(([k, v]) => dot.setAttribute(k, String(v)));
      draggable(dot, (bz, p) => moveControl(bz, edge, which as 0 | 1, p));
      out.push(dot);
    });
  });
  bezier.anchors.forEach(([x, y], index) => {
    const sq = document.createElementNS(SVG_NS, "rect");
    sq.classList.add("handle", "anchor");
    Object.entries({ x: x - r, y: y - r, width: 2 * r, height: 2 * r }).forEach(([k, v]) => sq.setAttribute(k, String(v)));
    sq.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (ev.altKey) patchBezier(id, removeAnchor(bezier, index));
    });
    draggable(sq, (bz, p) => moveAnchor(bz, index, p));
    out.push(sq);
  });
  return out;
}

// Realign: corners of the whole output, dragged back into place after the projector moves.
const realignButton = $<HTMLButtonElement>("realign");
const realignBar = $("realign-bar");
const brightness = $<HTMLInputElement>("brightness");
const brightnessReadout = $("brightness-readout");
let realigning = false;
let localAlignment: { corners?: number[][]; brightness?: number } | null = null; // shown at once, saved once per frame
let alignQueued = false;
let alignGesture: string | null = null; // one drag (or one slide) = one undo step
function align(change: { corners?: number[][]; brightness?: number }) {
  localAlignment = { ...localAlignment, ...change };
  alignGesture ??= `align-${Date.now().toString(36)}`;
  const gesture = alignGesture;
  if (!alignQueued) {
    alignQueued = true;
    requestAnimationFrame(() => {
      alignQueued = false;
      if (localAlignment) void engine.align({ ...localAlignment, gesture });
    });
  }
  renderAlignment();
  refresh();
}
/** Drops local alignment edits once the engine's show has them (its echo), like the editing session. */
function settleAlignment() {
  const a = show?.alignment;
  if (!localAlignment || !a || alignQueued || session.busy) return;
  const same = (localAlignment.brightness ?? a.brightness) === a.brightness
    && JSON.stringify(localAlignment.corners ?? a.corners) === JSON.stringify(a.corners);
  if (same) localAlignment = null;
}
const currentAlignment = () => {
  const w = show?.width ?? 1920, h = show?.height ?? 1080;
  const saved = show?.alignment ?? { corners: [[0, 0], [w, 0], [w, h], [0, h]], brightness: 1 };
  return { ...saved, ...localAlignment };
};
realignButton.addEventListener("click", () => {
  realigning = !realigning;
  renderAlignment();
  refresh();
});
brightness.addEventListener("input", () => align({ brightness: Number(brightness.value) }));
brightness.addEventListener("change", () => { alignGesture = null; }); // the slide ended
$("reset-alignment").addEventListener("click", () => {
  localAlignment = null;
  void engine.resetAlignment();
});
function renderAlignment() {
  settleAlignment();
  const a = currentAlignment();
  realignButton.classList.toggle("on", realigning);
  realignBar.hidden = !realigning;
  if (document.activeElement !== brightness) brightness.value = String(a.brightness);
  brightnessReadout.textContent = `${Math.round(a.brightness * 100)}%`;
}

/** Green handles on the output's four corners while realigning. */
function alignElements(r: number): SVGElement[] {
  if (!realigning || !show) return [];
  const corners = currentAlignment().corners;
  const quad = document.createElementNS(SVG_NS, "polygon");
  quad.classList.add("align");
  quad.setAttribute("points", corners.map(([x, y]) => `${x},${y}`).join(" "));
  const handles = corners.map(([x, y], index) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.classList.add("handle", "align");
    Object.entries({ cx: x, cy: y, r: 1.5 * r }).forEach(([k, v]) => c.setAttribute(k, String(v)));
    c.addEventListener("click", (ev) => ev.stopPropagation());
    c.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      session.begin();
      alignGesture = null;
      trackPointer(ev.pointerId, (move) => align({ corners: movePin(currentAlignment().corners, index, projectorPoint(move)) }), () => {
        alignGesture = null;
        session.end();
        refresh();
      });
    });
    return c;
  });
  return [quad, ...handles];
}

// Undo and redo, kept by the engine (so every editor and the output agree).
const undoButton = $<HTMLButtonElement>("undo");
const redoButton = $<HTMLButtonElement>("redo");
async function undoRedo(action: "undo" | "redo") {
  if (session.busy) return; // not mid-drag
  const r = await (action === "undo" ? engine.undo() : engine.redo());
  if (r.ok) localAlignment = null; // the engine's show is the truth again
}
undoButton.addEventListener("click", () => void undoRedo("undo"));
redoButton.addEventListener("click", () => void undoRedo("redo"));
bindUndoKeys((action) => void undoRedo(action));
function renderHistory() {
  const h = show?.history;
  undoButton.disabled = !h?.undo;
  redoButton.disabled = !h?.redo;
  undoButton.textContent = h?.undo ? `Undo ${h.undo.toLowerCase()}` : "Undo";
  redoButton.textContent = h?.redo ? `Redo ${h.redo.toLowerCase()}` : "Redo";
}

// Scenes: effects and settings for the same surfaces, in playlist order. Clicking a row opens (shows and edits) it.
const sceneList = $("scene-list");
$("add-scene").addEventListener("click", () => void engine.addScene({}));
$("duplicate-scene").addEventListener("click", () => {
  if (show?.scene != null) void engine.addScene({ duplicate: show.scene });
});
const crossfade = $<HTMLInputElement>("crossfade");
const loop = $<HTMLInputElement>("loop");
crossfade.addEventListener("change", () => {
  const v = Number(crossfade.value);
  if (v >= 0) void engine.setPlaylist({ crossfade: v });
});
loop.addEventListener("change", () => void engine.setPlaylist({ loop: loop.checked }));
function renderScenes() {
  const p = show?.playlist;
  if (p && document.activeElement !== crossfade) crossfade.value = String(p.crossfade);
  if (p) loop.checked = p.loop;
  const scenes = show?.scenes ?? [];
  // Don't rebuild under someone typing a name or a length.
  if (sceneList.contains(document.activeElement) && sceneList.children.length === scenes.length) {
    sceneList.querySelectorAll("li").forEach((li, i) => li.classList.toggle("open", scenes[i]?.id === show?.scene));
    return;
  }
  const ids = scenes.map((sc) => sc.id);
  sceneList.replaceChildren(...scenes.map((sc) => {
    const li = document.createElement("li");
    li.classList.toggle("open", sc.id === show?.scene);
    li.addEventListener("click", () => { if (sc.id !== show?.scene) void engine.openScene(sc.id); });
    const name = Object.assign(document.createElement("input"), { type: "text", value: sc.name, title: "Scene name" });
    name.addEventListener("change", () => void engine.updateScene(sc.id, { name: name.value }));
    const secs = Object.assign(document.createElement("input"), {
      type: "number", min: "0.5", max: "3600", step: "0.5", value: String(sc.duration), title: "Seconds in the playlist",
    });
    secs.addEventListener("change", () => {
      const v = Number(secs.value);
      if (v > 0) void engine.updateScene(sc.id, { duration: v });
    });
    const button = (label: string, title: string, run: () => void, disabled = false) => {
      const b = Object.assign(document.createElement("button"), { textContent: label, title, disabled });
      b.addEventListener("click", (ev) => { ev.stopPropagation(); run(); });
      return b;
    };
    const move = (delta: -1 | 1) => {
      const order = moveScene(ids, sc.id, delta);
      if (order) void engine.orderScenes(order);
    };
    li.append(
      name, secs, document.createTextNode("s"),
      button("↑", "Earlier in the playlist", () => move(-1), ids[0] === sc.id),
      button("↓", "Later in the playlist", () => move(1), ids[ids.length - 1] === sc.id),
      button("×", "Delete scene", () => void engine.deleteScene(sc.id), scenes.length === 1),
    );
    return li;
  }));
}

// Schedule: daily on/off times for unattended displays. Per-weekday times: see docs/http-api.md.
const scheduleEnabled = $<HTMLInputElement>("schedule-enabled");
const scheduleOn = $<HTMLInputElement>("schedule-on");
const scheduleOff = $<HTMLInputElement>("schedule-off");
const scheduleNext = $("schedule-next");
const autostart = $<HTMLInputElement>("autostart");
let schedule: Schedule | null = null;
let scheduleSaves = 0; // saves in flight: a reload mustn't overwrite fields a newer save holds
async function loadSchedule() {
  const r = await engine.schedule();
  if (!r.ok || scheduleSaves > 0) return;
  const got = (await r.json()) as { schedule: Schedule; next: { at: string; on: boolean } | null; autostart: boolean };
  schedule = got.schedule;
  scheduleEnabled.checked = schedule.enabled;
  if (document.activeElement !== scheduleOn) scheduleOn.value = schedule.on;
  if (document.activeElement !== scheduleOff) scheduleOff.value = schedule.off;
  scheduleNext.textContent = nextChangeText(got.next, new Date());
  autostart.checked = got.autostart;
}
async function saveSchedule() {
  if (!schedule || !scheduleOn.value || !scheduleOff.value) return;
  // Read every field now: each save sends the whole schedule as the fields show it.
  schedule = { ...schedule, enabled: scheduleEnabled.checked, on: scheduleOn.value, off: scheduleOff.value };
  scheduleSaves++;
  try {
    await engine.setSchedule(schedule);
  } finally {
    scheduleSaves--;
  }
  await loadSchedule();
}
for (const el of [scheduleEnabled, scheduleOn, scheduleOff]) el.addEventListener("change", () => void saveSchedule());
autostart.addEventListener("change", () => void engine.setAutostart(autostart.checked));
void loadSchedule();
setInterval(() => void loadSchedule(), 60_000); // keep "Turns on today at ..." current

// MIDI: knobs and keys bound to settings or actions, learned by moving one. Bindings are saved with
// the show; access is asked for on Connect (the browser shows a permission prompt).
const midi = new MidiRouter();
const midiConnect = $<HTMLButtonElement>("midi-connect");
const midiStatus = $("midi-status");
const midiLearnRow = $("midi-learn-row");
const midiTarget = $<HTMLSelectElement>("midi-target");
const midiLearn = $<HTMLButtonElement>("midi-learn");
const midiList = $("midi-list");
function targetLabel(t: MidiTarget): string {
  if ("action" in t) return ACTIONS.find((a) => a.action === t.action)!.label;
  const s = show?.surfaces.find((x) => x.id === t.surface);
  const label = s ? effectById(s.effect).params.find((p) => p.name === t.param)?.label : undefined;
  return `${s?.name ?? `Surface ${t.surface}`}: ${label ?? t.param}`;
}
function midiMenu(): TargetItem[] {
  const s = show?.surfaces.find((x) => x.id === show?.selected);
  return targetMenu(s ? { id: s.id, name: s.name ?? `Surface ${s.id}`, effect: effectById(s.effect) } : null);
}
// Rebuilt only when what they show changes: replacing the options of an open menu closes it, and
// renderMidi runs on every redraw (drags, zoom, show updates).
let midiChoice = ""; // the chosen target's key: stable when the list changes
let midiMenuShown = "";
let midiListShown = "";
midiTarget.addEventListener("change", () => { midiChoice = midiTarget.value; });
midiTarget.addEventListener("blur", () => renderMidi()); // catch up on changes held back while it was open
function renderMidi() {
  const items = midiMenu();
  const menu = items.map((i) => `${i.key}=${i.label}`).join("|");
  if (menu !== midiMenuShown && document.activeElement !== midiTarget) {
    midiMenuShown = menu;
    midiTarget.replaceChildren(...items.map((i) => Object.assign(document.createElement("option"), { value: i.key, textContent: i.label })));
    if (!items.some((i) => i.key === midiChoice)) midiChoice = items[0]?.key ?? "";
    midiTarget.value = midiChoice;
  }
  midiLearn.textContent = midi.armed ? "Move a knob…" : "Learn";
  midiLearn.classList.toggle("on", midi.armed !== null);
  const bindings = show?.midi ?? [];
  const list = JSON.stringify(bindings.map((b) => [b, targetLabel(b.target)]));
  if (list === midiListShown) return;
  midiListShown = list;
  midiList.replaceChildren(...bindings.map((b) => {
    const li = document.createElement("li");
    const name = `${b.kind === "cc" ? "Knob" : "Key"} ${b.number}${b.channel ? ` (ch ${b.channel + 1})` : ""}`;
    const remove = Object.assign(document.createElement("button"), { textContent: "×", title: "Remove" });
    // Remove this binding by what it is, not where it was in the list.
    remove.addEventListener("click", () => void engine.setMidi((show?.midi ?? []).filter((x) => JSON.stringify(x) !== JSON.stringify(b))));
    li.append(`${name} → ${targetLabel(b.target)}`, remove);
    return li;
  }));
}
midiLearn.addEventListener("click", () => {
  midi.arm(midi.armed ? null : midiMenu().find((i) => i.key === midiTarget.value)?.target ?? null);
  renderMidi();
});
function onMidi(data: Uint8Array) {
  const msg = parseMidi(data);
  if (!msg || !show) return;
  const bindings = show.midi ?? [];
  const result = midi.receive(msg, bindings);
  if (!result) return;
  if ("learned" in result) {
    const b = result.learned; // one knob or key does one thing: replace what it did before
    const others = bindings.filter((x) => !(x.kind === b.kind && x.channel === b.channel && x.number === b.number));
    void engine.setMidi([...others, b]);
    renderMidi();
  } else if ("setting" in result) {
    const { surface, param, value } = result.setting;
    const s = show.surfaces.find((x) => x.id === surface);
    const schema = s && effectById(s.effect).params.find((p) => p.name === param);
    const v = schema && settingValue(schema, value);
    if (v !== null && v !== undefined) {
      patchSurface(surface, { params: { [param]: v } }); // shown at once; one undo step per twist
      refresh();
    }
  } else {
    const a = result.action;
    if (a === "play" || a === "edit") void setMode(a);
    else if (a === "blackout") void toggleBlackout();
    else void stepScene(a === "next" ? 1 : -1);
  }
}
midiConnect.addEventListener("click", async () => {
  if (!("requestMIDIAccess" in navigator)) {
    midiStatus.textContent = "This browser has no MIDI (use Chrome)";
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const listen = () => {
      const inputs = [...access.inputs.values()];
      inputs.forEach((input) => { input.onmidimessage = (ev) => ev.data && onMidi(ev.data); });
      midiStatus.textContent = inputs.length ? inputs.map((i) => i.name).join(", ") : "No MIDI devices";
    };
    access.onstatechange = listen;
    listen();
    midiConnect.hidden = true;
    midiLearnRow.hidden = false;
  } catch {
    midiStatus.textContent = "MIDI access was refused";
  }
});

// Sidebar sections fold (#110): set-up-once ones start folded, your choice is remembered in this
// browser, and a section with a problem opens itself (folds.ts).
const FOLDS_KEY = "auto-mapper.folds";
const folds = [...document.querySelectorAll<HTMLDetailsElement>("details.fold")];
let savedFolds: Record<string, boolean> = {};
try {
  savedFolds = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}") ?? {};
} catch { /* private window or blocked storage: defaults */ }
const foldShown = new Map<string, boolean>(); // what applyFolds last set, to tell its toggles from yours
function applyFolds() {
  const problems = problemFolds(status ?? null);
  for (const d of folds) {
    const name = d.dataset.fold!;
    const open = foldOpen(name, savedFolds, problems);
    foldShown.set(name, open);
    if (d.open !== open) d.open = open;
  }
}
for (const d of folds) {
  d.addEventListener("toggle", () => {
    const name = d.dataset.fold!;
    if (foldShown.get(name) === d.open) return; // applyFolds did that
    foldShown.set(name, d.open);
    savedFolds[name] = d.open;
    try {
      localStorage.setItem(FOLDS_KEY, JSON.stringify(savedFolds));
    } catch { /* not remembered: still works this session */ }
  });
}
applyFolds();

const playButton = $<HTMLButtonElement>("play");
const blackoutButton = $<HTMLButtonElement>("blackout");
playButton.addEventListener("click", () => void setMode(show?.presentation.mode === "play" ? "edit" : "play"));
blackoutButton.addEventListener("click", () => void toggleBlackout());
bindPresentationKeys(() => show?.presentation.mode ?? "edit");

function renderPresentation() {
  const p = show?.presentation;
  playButton.textContent = p?.mode === "play" ? "Edit" : "Play";
  playButton.classList.toggle("on", p?.mode === "play");
  blackoutButton.classList.toggle("on", !!p?.blackout);
}

function renderPanel() {
  const surface = show?.surfaces.find((s) => s.id === show?.selected);
  surfacePanel.hidden = !surface;
  mergeButton.hidden = multi.size < 2;
  mergeButton.textContent = `Merge ${multi.size} surfaces`;
  if (!surface) return;
  surfaceTitle.textContent = `Surface ${surface.id}`;
  $("surface-source").textContent = SOURCE_TEXT[surface.source ?? "detected"] ?? "";
  if (document.activeElement !== surfaceName) surfaceName.value = surface.name ?? `Surface ${surface.id}`;
  if (document.activeElement !== surfaceEdge) surfaceEdge.value = String(surface.edge ?? 0);
  surfaceEdgeReadout.textContent = `${surface.edge ?? 0} px`;
  effectSelect.value = surface.effect;
  const effect = effectById(surface.effect);
  // Don't rebuild controls under the user's cursor while they drag; only when the surface/effect changes.
  const key = `${surface.id}:${effect.id}`;
  if (effectControls.dataset.key !== key) {
    effectControls.dataset.key = key;
    effectControls.replaceChildren(
      ...controlsFor(effect, surface.params).map((c) => {
        const row = Object.assign(document.createElement("label"), { className: "control" });
        if (c.kind === "media") return mediaControl(row, surface.id, c.name, c.label, c.value);
        if (c.kind === "text") {
          const area = Object.assign(document.createElement("textarea"), { value: c.value, rows: 3 });
          area.addEventListener("input", () => patchSurface(surface.id, { params: { [c.name]: area.value } }));
          row.append(Object.assign(document.createElement("span"), { textContent: c.label }), area);
          return row;
        }
        if (c.kind === "select") {
          const choose = document.createElement("select");
          choose.replaceChildren(...c.options.map((o) => Object.assign(document.createElement("option"), { value: o.value, textContent: o.label })));
          choose.value = c.value;
          choose.addEventListener("change", () => patchSurface(surface.id, { params: { [c.name]: choose.value } }));
          row.append(Object.assign(document.createElement("span"), { textContent: c.label }), choose);
          return row;
        }
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
  const plan = applyPlan(surface.id, multi, show?.surfaces.length ?? 0);
  applyButton.textContent = plan.label;
  applyButton.onclick = () =>
    void engine.applyEffect(surface.id, plan.to);
  const log = effectErrors.get(surface.id)?.log;
  effectError.hidden = !log;
  effectError.textContent = log ? `Shader error:\n${log}` : "";
}

/** A file picker: the chosen image or video is uploaded to the engine, then set on the surface. */
function mediaControl(row: HTMLLabelElement, surfaceId: number, name: string, label: string, src: string) {
  const current = Object.assign(document.createElement("span"), { className: "muted", textContent: mediaLabel(src) });
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*,video/*" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    current.textContent = `Uploading ${file.name}…`;
    const res = await engine.uploadMedia(file);
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      current.textContent = mediaLabel(src);
      notice(`Upload failed: ${detail?.detail ?? res.statusText}`);
      return;
    }
    const uploaded: { url: string } = await res.json();
    src = uploaded.url;
    current.textContent = mediaLabel(src);
    patchSurface(surfaceId, { params: { [name]: src } });
  });
  row.append(Object.assign(document.createElement("span"), { textContent: label }), current, input);
  return row;
}

effectSelect.addEventListener("change", () => {
  if (show?.selected != null) void engine.patchSurface(show.selected, { effect: effectSelect.value });
});
surfacesSvg.addEventListener("click", () => select(null));
surfaceName.addEventListener("change", () => {
  if (show?.selected != null) void engine.patchSurface(show.selected, { name: surfaceName.value });
});
function deleteSelected(ids: number[]) {
  multi.clear();
  void engine.deleteSurfaces(ids); // one undo step for all of them
}
deleteButton.addEventListener("click", () => {
  const ids = deleteKeyTargets({ key: "Delete", target: "BODY", metaKey: false, ctrlKey: false, altKey: false }, show?.selected ?? null, multi);
  if (ids) deleteSelected(ids);
});
// Delete or Backspace: the selected surface and any shift-clicked ones (not while typing or drawing).
window.addEventListener("keydown", (ev) => {
  if (draw.active || session.busy) return;
  const el = ev.target as HTMLElement;
  const target = el.isContentEditable ? "TEXTAREA" : el.tagName;
  const ids = deleteKeyTargets({ key: ev.key, target, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey }, show?.selected ?? null, multi);
  if (!ids) return;
  ev.preventDefault();
  deleteSelected(ids);
});
mergeButton.addEventListener("click", () => {
  const ids = [...multi];
  multi.clear();
  void engine.merge(ids);
});

const missed = $<HTMLCanvasElement>("missed");
const showMissed = $<HTMLInputElement>("show-missed");
const scanWarnings = $("scan-warnings");
let missedFor = "";

/** Tints the areas the scan could not decode, from the engine's coverage mask. */
function renderMissed() {
  missed.hidden = !showMissed.checked || !scanState.image;
  if (missed.hidden || missedFor === scanState.image) return;
  missedFor = scanState.image!;
  const img = new Image();
  img.onload = () => {
    missed.width = img.width;
    missed.height = img.height;
    const ctx = missed.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const decoded = data.data[i] > 127;
      data.data.set(decoded ? [0, 0, 0, 0] : [239, 68, 68, 140], i);
    }
    ctx.putImageData(data, 0, 0);
  };
  img.src = `/api/scan/latest-mask.png?t=${Date.now()}`;
}
showMissed.addEventListener("change", renderMissed);

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

  // While scanning, the Scan button cancels.
  scan.textContent = scanState.running ? "Cancel scan" : "Scan";
  if (scanState.running) scan.disabled = false;
  scanWarnings.replaceChildren(
    ...scanState.warnings.map((w) => Object.assign(document.createElement("div"), { className: "banner", textContent: w })),
  );
  renderMissed();
}

function render() {
  const view = describeStatus(status);
  banners.replaceChildren(
    ...view.banners.map((text) => Object.assign(document.createElement("div"), { className: "banner", textContent: text })),
  );
  projectorSelect.replaceChildren(
    ...projectorOptions(status).map((o) => Object.assign(document.createElement("option"), o)),
  );
  output.textContent = view.output;
  output.className = status?.output_connected ? "ok" : "bad";
  scan.disabled = !view.scanEnabled;
  $("fps").textContent = status?.output_fps ? `${status.output_fps} fps` : "–";
  projectName.textContent = `· ${view.project}`;
  if (status?.project && document.activeElement !== projectSaveName && !projectSaveName.value) {
    projectSaveName.value = status.project.name;
  }
  calibration.textContent = view.calibration;
  cameraSelect.replaceChildren(
    ...cameraOptions(status).map((o) => Object.assign(document.createElement("option"), o)),
  );
  calibrate.disabled = !status?.output_connected || !status.camera.selected;
}

// Sound: the output window listens; the editor switches it and shows its meter.
const soundToggle = $<HTMLButtonElement>("sound-toggle");
let lastSoundKey = "";
const soundInput = $<HTMLSelectElement>("sound-input");
const postSound = (body: Parameters<typeof engine.sound>[0]) => void engine.sound(body);
soundToggle.addEventListener("click", () => postSound({ enabled: !show?.sound?.enabled, device: soundInput.value || undefined }));
soundInput.addEventListener("change", () => postSound({ device: soundInput.value }));
const soundSource = $<HTMLSelectElement>("sound-source");
// Video sound: effects follow the videos playing with sound (no mic, no feedback from the speakers).
soundSource.addEventListener("change", () => postSound({ source: soundSource.value }));
const soundOutputSelect = $<HTMLSelectElement>("sound-output");
soundOutputSelect.addEventListener("change", () => postSound({ output: soundOutputSelect.value }));
const soundDelay = $<HTMLInputElement>("sound-delay");
const delayText = (ms: number) => (ms === 0 ? "0 ms" : ms > 0 ? `${ms} ms later` : `${-ms} ms earlier`);
soundDelay.addEventListener("input", () => { $("sound-delay-readout").textContent = delayText(Number(soundDelay.value)); });
soundDelay.addEventListener("change", () => postSound({ delay: Number(soundDelay.value) })); // saved when let go
async function refreshSoundInputs() {
  // Same origin as the output window, so device ids match; labels appear once the mic is allowed.
  const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [];
  const outputs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default");
  const chosenOutput = show?.sound?.output ?? "";
  soundOutputSelect.replaceChildren(
    Object.assign(document.createElement("option"), { value: "", textContent: "Sound output: Mac default", selected: !chosenOutput }),
    ...outputs.map((d, i) =>
      Object.assign(document.createElement("option"), { value: d.deviceId, textContent: `Sound output: ${d.label || `Output ${i + 1}`}`, selected: d.deviceId === chosenOutput })),
  );
  const inputs = devices.filter((d) => d.kind === "audioinput");
  const chosen = show?.sound?.device ?? "";
  soundInput.replaceChildren(
    Object.assign(document.createElement("option"), { value: "", textContent: "Default input", selected: !chosen }),
    ...inputs.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) =>
      Object.assign(document.createElement("option"), { value: d.deviceId, textContent: d.label || `Input ${i + 1}`, selected: d.deviceId === chosen })),
  );
}
navigator.mediaDevices?.addEventListener("devicechange", () => void refreshSoundInputs());
void refreshSoundInputs();
function renderSound() {
  const v = describeSound(show?.sound ?? { enabled: false, device: null }, status?.output_connected ? status.output_sound ?? null : null);
  soundToggle.textContent = `React to sound: ${v.on ? "on" : "off"}`;
  const source = show?.sound?.source ?? "mic";
  if (document.activeElement !== soundSource) soundSource.value = source;
  soundInput.hidden = source === "video";
  soundToggle.classList.toggle("on", v.on);
  $<HTMLMeterElement>("sound-meter").value = v.meter;
  $("sound-note").textContent = v.note;
  const chosen = (show?.surfaces ?? []).filter((s) => s.effect === "media" && s.params.sound === "on")
    .map((s) => String(s.params.channel ?? "all"));
  $("sound-channels").textContent = channelNote(status?.output_connected ? status.output_sound_channels ?? null : null, chosen);
  if (document.activeElement !== soundDelay) {
    soundDelay.value = String(show?.sound?.delay ?? 0);
    $("sound-delay-readout").textContent = delayText(Number(soundDelay.value));
  }
}

function notice(text: string) {
  const note = Object.assign(document.createElement("div"), { className: "banner", textContent: text });
  banners.append(note);
  setTimeout(() => note.remove(), 6000);
}

// Every engine show is applied here, exactly once, whether it arrived idle or during a drag.
session.subscribe((view) => {
  show = view;
  for (const id of [...multi]) if (!view.surfaces.some((s) => s.id === id)) multi.delete(id);
  // An error belongs to one effect; switching the surface to another effect clears it.
  for (const s of view.surfaces) if (effectErrors.get(s.id)?.effect !== s.effect) effectErrors.delete(s.id);
  renderSurfaces();
  const soundKey = JSON.stringify(view.sound ?? null);
  if (soundKey !== lastSoundKey) {
    lastSoundKey = soundKey; // settings changed: re-list inputs (labels appear once the mic is allowed)
    void refreshSoundInputs();
  }
  renderSound();
});

connect({
  hello: () => ({ type: "hello", role: "editor" }),
  onMessage(msg) {
    if (msg.type === "status") {
      const projectChanged = msg.project?.slug !== status?.project?.slug;
      status = msg;
      if (projectChanged) void refreshProjects();
      render();
      renderSound();
      applyFolds(); // a problem opens its section
      renderScan();
    } else if (msg.type === "show") {
      session.receive(msg); // applied now, or when the current drag ends: see session.subscribe below
    } else if (msg.type === "show_cleared") {
      location.reload(); // a new project: start the Editor over, empty
    } else if (msg.type === "scan_reload") {
      void reloadScan();
      void refreshProjects();
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

const showPlacement = (note: string | null) => note && notice(note);
$("open-output").addEventListener("click", () => void placeOutput(status?.hardware.projector ?? null).then(showPlacement));
$("refresh").addEventListener("click", () => void engine.refreshHardware());
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-test-frame]")) {
  btn.addEventListener("click", () =>
    void engine.testFrame(btn.dataset.testFrame as TestFrameKind),
  );
}
scan.addEventListener("click", async () => {
  if (scanState.running) {
    void engine.cancelScan();
    return;
  }
  if (previewTimer !== undefined) previewToggle.click(); // the scan needs the camera to itself
  const res = await engine.startScan();
  if (!res.ok) notice(`Cannot scan: ${(await res.json()).detail}`);
});
// Show the last scan, with its surfaces, after a reload.
void reloadScan();
void refreshProjects();

projectSave.addEventListener("click", async () => {
  const name = projectSaveName.value.trim();
  if (!name) return notice("Name the project first.");
  const r = await engine.saveProject(name);
  notice(r.ok ? `Saved "${name}".` : `Cannot save: ${(await r.json()).detail}`);
  void refreshProjects();
});

projectorSelect.addEventListener("change", () => {
  const display = status?.hardware.displays.find((d) => d.key === projectorSelect.value) ?? null;
  // Move the output first, while the change still counts as a user gesture (permission prompt).
  void placeOutput(display).then(showPlacement);
  void engine.selectProjector(projectorSelect.value);
});

cameraSelect.addEventListener("change", () =>
  void engine.selectCamera(cameraSelect.value),
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
    void engine.releaseCamera();
  }
});

calibrate.addEventListener("click", async () => {
  calibrate.disabled = true;
  calibrate.textContent = "Calibrating…";
  try {
    const res = await engine.calibrate();
    const body = await res.json();
    notice(res.ok ? `Calibrated: exposure ${body.exposure}, white peak ${Math.round(body.p99)}` : `Calibration failed: ${body.detail}`);
  } finally {
    if (previewTimer === undefined) void engine.releaseCamera();
    calibrate.textContent = "Calibrate exposure";
    render();
  }
});
render();
