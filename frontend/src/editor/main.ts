import { connect } from "../shared/connection";
import type { StatusMessage, TestFrameKind } from "../shared/messages";
import { EFFECTS, effectById } from "../effects/index";
import type { SceneMessage } from "../shared/messages";
import { bindPresentationKeys, setMode, toggleBlackout } from "../shared/presentation";
import { applyPlan } from "./applyEffect";
import { controlsFor, mediaLabel, parseControlValue } from "./controls";
import { type Bezier, curveBezierEdge, flatten, fromPolygon, insertAnchor, moveAnchor, moveControl, removeAnchor } from "./bezier";
import { handleIndices, moveOnRun, nearestEdge } from "./curves";
import { drawStep, idleDraw, type DrawEvent } from "./drawing";
import { insertVertex, removeVertex, toProjector } from "./polygonEdit";
import { initialScan, scanLabel, scanReducer, type ScanState } from "./scanState";
import { canFrame, panAfterDrag, zoomAfterWheel } from "./framing";
import { movePin, pinHandles } from "./pin";
import { placeOutput } from "./screens";
import { describeSound } from "./soundView";
import { cameraOptions, describeStatus, projectorOptions } from "./statusView";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const banners = $("banners");
const projectorSelect = $<HTMLSelectElement>("projector-select");
const output = $("output");
const cameras = $("cameras");
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

async function refreshProjects() {
  const res = await fetch("/api/projects");
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
            const r = await fetch(`/api/projects/${p.slug}/open`, { method: "POST" });
            if (!r.ok) notice(`Cannot open: ${(await r.json()).detail}`);
          },
        }),
      );
      return li;
    }),
  );
}

async function reloadScan() {
  const r = await fetch("/api/scan/latest");
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
const surfaceName = $<HTMLInputElement>("surface-name");
const deleteButton = $<HTMLButtonElement>("delete-surface");
const mergeButton = $<HTMLButtonElement>("merge-surfaces");
const applyButton = $<HTMLButtonElement>("apply-effect");
const multi = new Set<number>(); // shift-click selection for merging
let dragging: { id: number; index: number; polygon: number[][]; bezier?: Bezier } | null = null;
let pendingScene: SceneMessage | null = null; // scene updates held back while dragging

function projectorPoint(ev: MouseEvent): number[] {
  const r = surfacesSvg.getBoundingClientRect();
  return toProjector(r, scanState.size ?? { width: scene!.width, height: scene!.height }, ev.clientX, ev.clientY);
}

let patchFrame = 0;
function patchPolygonSoon(id: number, polygon: number[][], bezier?: Bezier) {
  // At most one PATCH per animation frame while dragging.
  cancelAnimationFrame(patchFrame);
  patchFrame = requestAnimationFrame(() => patchSurface(id, bezier ? { polygon, bezier } : { polygon }));
}

/** Saves a Bezier outline: the engine stores it with its flattened polygon. */
const patchBezier = (id: number, bezier: Bezier) => patchSurface(id, { polygon: flatten(bezier), bezier });

const select = (id: number | null) =>
  void fetch("/api/scene/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });

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
  manual: "Drawn by you (kept on redetect)",
};

function drawEvent(ev: DrawEvent) {
  draw = drawStep(draw, ev);
  if (draw.finished) {
    void fetch("/api/scene/surfaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polygon: draw.finished }),
    });
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
  const surface = scene?.surfaces.find((x) => x.id === scene?.selected);
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
  const r = await fetch("/api/scene/redetect", { method: "POST" });
  notice(r.ok ? "Surfaces detected again. Drawn and edited surfaces were kept." : `Cannot redetect: ${(await r.json()).detail}`);
});

function draftElements(): SVGElement[] {
  if (!draw.active || draw.points.length === 0) return [];
  const line = document.createElementNS(SVG_NS, "polyline");
  line.classList.add("draft");
  line.setAttribute("points", draw.points.map(([x, y]) => `${x},${y}`).join(" "));
  const r = (4 * (scene?.width ?? 1920)) / Math.max(1, surfacesSvg.getBoundingClientRect().width);
  const dots = draw.points.map(([x, y]) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.classList.add("draft");
    Object.entries({ cx: x, cy: y, r }).forEach(([k, v]) => c.setAttribute(k, String(v)));
    return c;
  });
  return [line, ...dots];
}

function renderSurfaces() {
  const surfaces = scene?.surfaces ?? [];
  const width = scene?.width ?? 1920;
  // Handle size in projector pixels that looks ~7 screen px whatever the editor's scale.
  const r = (7 * width) / Math.max(1, surfacesSvg.getBoundingClientRect().width);
  surfacesSvg.replaceChildren(
    ...surfaces.flatMap((s) => {
      const bezier = dragging?.id === s.id && dragging.bezier ? dragging.bezier : s.bezier;
      const polygon = dragging?.id === s.id ? dragging.polygon : s.polygon;
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", polygon.map(([x, y]) => `${x},${y}`).join(" "));
      poly.classList.toggle("selected", s.id === scene?.selected);
      poly.classList.toggle("multi", multi.has(s.id));
      poly.classList.toggle("error", effectErrors.has(s.id));
      if (s.id === scene?.selected && canFrame(effectById(s.effect))) bindFraming(poly, s);
      poly.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (framedJustNow) {
          framedJustNow = false; // the click that ends a framing drag isn't a selection click
          return;
        }
        if (ev.shiftKey) {
          multi.has(s.id) ? multi.delete(s.id) : multi.add(s.id);
          if (scene?.selected != null) multi.add(scene.selected);
          renderSurfaces();
          return;
        }
        multi.clear();
        select(s.id === scene?.selected ? null : s.id);
      });
      poly.addEventListener("dblclick", (ev) => {
        if (s.id !== scene?.selected) return;
        ev.stopPropagation();
        if (s.bezier) patchBezier(s.id, insertAnchor(s.bezier, projectorPoint(ev)));
        else patchSurface(s.id, { polygon: insertVertex(s.polygon, projectorPoint(ev)) });
      });
      const [x, y] = polygon[0];
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(x + 12));
      label.setAttribute("y", String(y + 34));
      label.textContent = String(s.id);
      const parts: SVGElement[] = [poly, label];
      if (s.id === scene?.selected && bezier) {
        parts.push(...bezierHandles(s.id, bezier, r));
      } else if (s.id === scene?.selected) {
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
            handle.setPointerCapture(ev.pointerId);
            dragging = { id: s.id, index, polygon: s.polygon };
          });
          handle.addEventListener("pointermove", (ev) => {
            if (!dragging || dragging.index !== index) return;
            dragging.polygon = moveOnRun(dragging.polygon, index, projectorPoint(ev));
            patchPolygonSoon(s.id, dragging.polygon);
            renderSurfaces();
          });
          handle.addEventListener("pointerup", () => {
            if (!dragging) return;
            patchSurface(s.id, { polygon: dragging.polygon });
            dragging = null;
            if (pendingScene) {
              scene = pendingScene;
              pendingScene = null;
            }
            renderSurfaces();
          });
          parts.push(handle);
        });
      }
      return parts;
    }),
    ...pinElements(r),
    ...draftElements(),
  );
  renderPanel();
  renderPresentation();
}

// Framing media by hand: drag inside the selected surface to pan, scroll to zoom.
let framedJustNow = false;
let framing = false; // a pan drag is in progress: hold scene updates so the SVG isn't rebuilt under it
function bindFraming(poly: SVGPolygonElement, s: SceneMessage["surfaces"][number]) {
  const num = (name: string, fallback: number) => (typeof s.params[name] === "number" ? (s.params[name] as number) : fallback);
  let drag: { start: number[]; moved: boolean } | null = null;
  poly.addEventListener("pointerdown", (ev) => {
    if (ev.altKey || ev.shiftKey || ev.button !== 0) return;
    drag = { start: projectorPoint(ev), moved: false };
    framing = true;
    poly.setPointerCapture(ev.pointerId);
  });
  poly.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const p = projectorPoint(ev);
    const delta = [p[0] - drag.start[0], p[1] - drag.start[1]];
    if (!drag.moved && Math.hypot(delta[0], delta[1]) < 4) return; // still a click
    drag.moved = true;
    const pan = panAfterDrag({ panX: num("panX", 0), panY: num("panY", 0) }, delta, s.polygon);
    cancelAnimationFrame(patchFrame);
    patchFrame = requestAnimationFrame(() => patchSurface(s.id, { params: pan }));
  });
  poly.addEventListener("pointerup", () => {
    framedJustNow = !!drag?.moved;
    drag = null;
    framing = false;
    if (pendingScene) {
      scene = pendingScene;
      pendingScene = null;
      renderSurfaces();
    }
  });
  poly.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const zoom = zoomAfterWheel(num("zoom", 1), ev.deltaY);
    cancelAnimationFrame(patchFrame);
    patchFrame = requestAnimationFrame(() => patchSurface(s.id, { params: { zoom } }));
  }, { passive: false });
}

// Corner pin being dragged: shown from here until the engine's scene update arrives.
let pinDrag: { id: number; name: string; corners: number[][]; index: number } | null = null;

/** Orange diamonds (and a dashed quad) for the selected surface's corner pin, when its effect uses one.
 *  Drag a corner to pin it; Alt-click any corner to go back to the outline's own corners. */
function pinElements(r: number): SVGElement[] {
  const s = scene?.surfaces.find((x) => x.id === scene?.selected);
  if (!s) return [];
  const pin = pinHandles(effectById(s.effect), s.params, s.polygon);
  if (!pin) return [];
  const corners = pinDrag?.id === s.id ? pinDrag.corners : pin.corners;
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
      d.setPointerCapture(ev.pointerId);
      pinDrag = { id: s.id, name: pin.name, corners: pin.corners, index };
    });
    d.addEventListener("pointermove", (ev) => {
      if (!pinDrag || pinDrag.index !== index) return;
      pinDrag.corners = movePin(pinDrag.corners, index, projectorPoint(ev));
      const { id, name, corners: next } = pinDrag;
      cancelAnimationFrame(patchFrame); // at most one PATCH per frame, so the projector follows the drag
      patchFrame = requestAnimationFrame(() => patchSurface(id, { params: { [name]: next } }));
      renderSurfaces();
    });
    d.addEventListener("pointerup", () => {
      if (!pinDrag) return;
      patchSurface(pinDrag.id, { params: { [pinDrag.name]: pinDrag.corners } });
      pinDrag = null;
      if (pendingScene) {
        scene = pendingScene;
        pendingScene = null;
      }
      renderSurfaces();
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
  const draggable = (el: SVGElement, index: number, update: (b: Bezier, p: number[]) => Bezier) => {
    el.addEventListener("pointerdown", (ev) => {
      if ((ev as PointerEvent).altKey) return;
      ev.stopPropagation();
      el.setPointerCapture((ev as PointerEvent).pointerId);
      dragging = { id, index, polygon: flatten(bezier), bezier };
    });
    el.addEventListener("pointermove", (ev) => {
      if (!dragging || dragging.id !== id || dragging.index !== index || !dragging.bezier) return;
      dragging.bezier = update(dragging.bezier, projectorPoint(ev as MouseEvent));
      dragging.polygon = flatten(dragging.bezier);
      patchPolygonSoon(id, dragging.polygon, dragging.bezier);
      renderSurfaces();
    });
    el.addEventListener("pointerup", () => {
      if (!dragging?.bezier) return;
      patchBezier(id, dragging.bezier);
      dragging = null;
      if (pendingScene) {
        scene = pendingScene;
        pendingScene = null;
      }
      renderSurfaces();
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
      // Control handles get indices after the anchors so drags don't mix them up.
      draggable(dot, n + edge * 2 + which, (bz, p) => moveControl(bz, edge, which as 0 | 1, p));
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
    draggable(sq, index, (bz, p) => moveAnchor(bz, index, p));
    out.push(sq);
  });
  return out;
}

const playButton = $<HTMLButtonElement>("play");
const blackoutButton = $<HTMLButtonElement>("blackout");
playButton.addEventListener("click", () => void setMode(scene?.presentation.mode === "play" ? "edit" : "play"));
blackoutButton.addEventListener("click", () => void toggleBlackout());
bindPresentationKeys(() => scene?.presentation.mode ?? "edit");

function renderPresentation() {
  const p = scene?.presentation;
  playButton.textContent = p?.mode === "play" ? "Edit" : "Play";
  playButton.classList.toggle("on", p?.mode === "play");
  blackoutButton.classList.toggle("on", !!p?.blackout);
}

function renderPanel() {
  const surface = scene?.surfaces.find((s) => s.id === scene?.selected);
  surfacePanel.hidden = !surface;
  mergeButton.hidden = multi.size < 2;
  mergeButton.textContent = `Merge ${multi.size} surfaces`;
  if (!surface) return;
  surfaceTitle.textContent = `Surface ${surface.id}`;
  $("surface-source").textContent = SOURCE_TEXT[surface.source ?? "detected"] ?? "";
  if (document.activeElement !== surfaceName) surfaceName.value = surface.name ?? `Surface ${surface.id}`;
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
          area.addEventListener("input", () => {
            cancelAnimationFrame(patchFrame); // typing: at most one PATCH per frame
            patchFrame = requestAnimationFrame(() => patchSurface(surface.id, { params: { [c.name]: area.value } }));
          });
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
  const plan = applyPlan(surface.id, multi, scene?.surfaces.length ?? 0);
  applyButton.textContent = plan.label;
  applyButton.onclick = () =>
    void fetch("/api/scene/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: surface.id, ...(plan.to ? { to: plan.to } : {}) }),
    });
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
    const res = await fetch(`/api/media?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
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
  if (scene?.selected != null) patchSurface(scene.selected, { effect: effectSelect.value });
});
surfacesSvg.addEventListener("click", () => select(null));
surfaceName.addEventListener("change", () => {
  if (scene?.selected != null) patchSurface(scene.selected, { name: surfaceName.value });
});
deleteButton.addEventListener("click", () => {
  if (scene?.selected != null) void fetch(`/api/scene/surfaces/${scene.selected}`, { method: "DELETE" });
});
mergeButton.addEventListener("click", () => {
  const ids = [...multi];
  multi.clear();
  void fetch("/api/scene/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
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
  cameras.textContent = view.cameras;
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
const postSound = (body: object) =>
  void fetch("/api/sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
soundToggle.addEventListener("click", () => postSound({ enabled: !scene?.sound?.enabled, device: soundInput.value || undefined }));
soundInput.addEventListener("change", () => postSound({ device: soundInput.value }));
async function refreshSoundInputs() {
  // Same origin as the output window, so device ids match; labels appear once the mic is allowed.
  const inputs = (await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? []).filter((d) => d.kind === "audioinput");
  const chosen = scene?.sound?.device ?? "";
  soundInput.replaceChildren(
    Object.assign(document.createElement("option"), { value: "", textContent: "Default input", selected: !chosen }),
    ...inputs.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) =>
      Object.assign(document.createElement("option"), { value: d.deviceId, textContent: d.label || `Input ${i + 1}`, selected: d.deviceId === chosen })),
  );
}
navigator.mediaDevices?.addEventListener("devicechange", () => void refreshSoundInputs());
void refreshSoundInputs();
function renderSound() {
  const v = describeSound(scene?.sound ?? { enabled: false, device: null }, status?.output_connected ? status.output_sound ?? null : null);
  soundToggle.textContent = `React to sound: ${v.on ? "on" : "off"}`;
  soundToggle.classList.toggle("on", v.on);
  $<HTMLMeterElement>("sound-meter").value = v.meter;
  $("sound-note").textContent = v.note;
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
      const projectChanged = msg.project?.slug !== status?.project?.slug;
      status = msg;
      if (projectChanged) void refreshProjects();
      render();
      renderSound();
      renderScan();
    } else if (msg.type === "scene") {
      if (dragging || pinDrag || framing) {
        pendingScene = msg; // don't rebuild the handles under the cursor
        return;
      }
      scene = msg;
      for (const id of [...multi]) if (!msg.surfaces.some((s) => s.id === id)) multi.delete(id);
      // An error belongs to one effect; switching the surface to another effect clears it.
      for (const s of msg.surfaces) if (effectErrors.get(s.id)?.effect !== s.effect) effectErrors.delete(s.id);
      renderSurfaces();
      const soundKey = JSON.stringify(msg.sound ?? null);
      if (soundKey !== lastSoundKey) {
        lastSoundKey = soundKey; // settings changed: re-list inputs (labels appear once the mic is allowed)
        void refreshSoundInputs();
      }
      renderSound();
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
  if (scanState.running) {
    void fetch("/api/scan/cancel", { method: "POST" });
    return;
  }
  if (previewTimer !== undefined) previewToggle.click(); // the scan needs the camera to itself
  const res = await fetch("/api/scan", { method: "POST" });
  if (!res.ok) notice(`Cannot scan: ${(await res.json()).detail}`);
});
// Show the last scan, with its surfaces, after a reload.
void reloadScan();
void refreshProjects();

projectSave.addEventListener("click", async () => {
  const name = projectSaveName.value.trim();
  if (!name) return notice("Name the project first.");
  const r = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  notice(r.ok ? `Saved "${name}".` : `Cannot save: ${(await r.json()).detail}`);
  void refreshProjects();
});

projectorSelect.addEventListener("change", () => {
  const display = status?.hardware.displays.find((d) => d.key === projectorSelect.value) ?? null;
  // Move the output first, while the change still counts as a user gesture (permission prompt).
  void placeOutput(display).then(showPlacement);
  void fetch("/api/projector", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: projectorSelect.value }),
  });
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
