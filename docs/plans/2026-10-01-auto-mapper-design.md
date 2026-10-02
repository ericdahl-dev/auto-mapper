# auto-mapper design

> **Historical:** this is the original plan from 2026-10-01. The code has moved on (its own
> Gray-code decoder rather than OpenCV's `GrayCodePattern`, projects in
> `~/.auto-mapper/projects/`, and more). See the README for how it works now.

A Lightform-style projection mapper: scan a scene with a projector and webcam, detect surfaces
automatically, apply effects to them, and play the result back on the projector.

v1 goal: the full loop works end to end, with each stage kept thin.

## Hardware

- Mac laptop (M2 Max) driving everything
- Projector on HDMI as an extended display, 1920x1080 @ 60Hz (shows as "AML TV")
- Webcam AC410 (UVC 0xf131:0x1306), controlled with `uvc-util`
- Optional later: iPhone Continuity Camera as a higher-quality capture source

## Architecture

One local app, served from `localhost`, with three parts:

```
Python engine (FastAPI)
 ├─ camera.py      webcam capture, UVC lock/restore
 ├─ scan.py        Gray-code pattern sequence + decode
 ├─ surfaces.py    segment scan into surface polygons
 └─ project store  ./projects/<name>/
      │  REST + WebSocket
      ▼
Editor (browser, laptop screen)     Output (browser, fullscreen on projector)
 scan view, surfaces, effects  <->   patterns during scan, effects during playback
```

Decisions:

- **The browser output window owns the projector at all times, including during a scan.**
  Python sends "show pattern N" over WebSocket, the page draws it, waits two animation frames
  and sends an ack, then Python captures. No Python fullscreen windows.
- **Everything is stored in projector coordinates.** After the scan the camera is not needed
  for playback.
- **Project format:** `projects/<name>/` holds `scan.png` (scene from the projector's point of
  view), the decoded map (`map.npz`), and `project.json` (surfaces as polygons plus each
  surface's effect and params). Playback reads only `project.json` and assets.
- **Stack:** Python 3.12 via `uv`, FastAPI, `opencv-contrib-python`, NumPy. Frontend is Vite +
  TypeScript + plain WebGL2, no UI framework.

## Scan pipeline

1. **Camera lock.** Save the current UVC settings, disable auto exposure, auto white balance and
   autofocus, then pick exposure and gain so the white reference frame does not clip.
2. **Patterns.** Gray-code columns and rows for 1920x1080 (about 11 + 11 bits), each followed by
   its inverse, plus white and black reference frames. About 46 frames.
3. **Lockstep capture.** For each frame: send the pattern, wait for the ack, drop one possibly
   stale camera frame, capture the next.
4. **Decode** with OpenCV `structured_light.GrayCodePattern`, comparing each pattern to its
   inverse. Build a mask of pixels the projector actually lit.
5. **Remap** the result into a projector-space image of the scene, `scan.png`.
6. **Restore** the camera settings in a `finally` block.

## Surface detection

A single uncalibrated camera gives no true depth, so detection combines two cues in projector
space:

- **Decode discontinuities:** neighbouring projector pixels whose camera positions jump far
  apart mark edges between objects at different depths. This is the strongest cue.
- **Color and brightness edges** in `scan.png`.

These are merged into one edge map. The regions between edges are filled, small ones dropped,
and each remaining region is simplified to a polygon with `approxPolyDP`.

The editor shows the regions as selectable overlays. The user can select, merge, delete and drag
vertices. Auto-detect does most of the work and a few manual edits finish it. Drawing a polygon
by hand on `scan.png` is always available as a fallback.

## Effects

Effects are GLSL fragment shaders run on the output page. Each surface is a projector-space
polygon, and each shader receives `u_time`, surface bounds and local UVs, `u_scan` (the scan
image), and its own params.

Each effect is one `.ts` file holding its shader and a param schema (name, type, range,
default). The editor builds its controls from the schema.

v1 effects:

- **Solid / gradient** fill
- **Outline trace:** a glowing line chasing around the polygon edge
- **Scan-reactive:** tint, edge glow or posterize applied to the real scene
- **Noise flow:** animated generative pattern
- **Video / image:** media mapped to the surface bounds and clipped to the polygon

## Editor and playback

- Editor: scan image with surface overlays on the left; the selected surface's effect and params
  on the right. Every change is pushed to the output window over WebSocket, so the projector
  updates live.
- **Play** puts the output in clean mode with no overlays. There is a blackout key and a Rescan
  action.
- Opening a saved project goes straight to playback.

Out of scope for v1: timelines and scene sequences, audio reactivity, multiple projectors,
running on its own without the laptop.

## Error handling

- **Missing camera or second display:** an editor banner appears and Scan is disabled.
- **Output window not connected, or an ack missing for about 2 s:** the scan aborts with a clear
  message and never hangs.
- **Low decode coverage (under about 40%):** a warning plus a coverage mask showing where the
  scan failed.
- **Camera settings** are always restored, even if the scan crashes.
- **A broken shader** shows a red outline on its surface and the GLSL log in the editor. Other
  surfaces keep running.

## Testing

- **Synthetic scan tests (pytest):** render Gray-code patterns through a known transform (a
  homography plus a two-plane depth step), decode, and compare against ground truth. Surface
  detection is tested on the same synthetic scenes, for example two boxes give two polygons.
- **Recorded fixture:** one real scan from this rig saved to `fixtures/` and run again through
  decode and detection in tests.
- **Frontend (Vitest):** effect schemas, project JSON round-trip, WebSocket protocol, and a
  shader compile check in headless WebGL.
- **`make scan-check`:** a real scan on the connected rig that prints coverage and the surface
  count.
