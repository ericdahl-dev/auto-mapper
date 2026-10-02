# Engine HTTP and WebSocket API

The engine (`engine/app.py`) serves on `http://127.0.0.1:8765`. In development, the Vite server on `:5173` proxies `/api` and `/ws` to it, so the editor and output pages use same-origin URLs. Request and message shapes are defined in `engine/messages.py` and mirrored in `frontend/src/shared/messages.ts`.

This is an internal API between the engine and its two pages, not a stable public one. Errors come back as FastAPI's `{"detail": "..."}` with the status codes listed below.

Most write routes respond with the updated scene and also broadcast it over the WebSocket, so every editor and the output window stay in sync.

## Status and hardware

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/status` | | Status: hardware (projector, `projector_missing`, displays, cameras, issues), output connection and resolution, output fps, selected camera and its calibration, active project, `can_scan` |
| POST | `/api/hardware/refresh` | | Probes displays and cameras again; returns status |
| POST | `/api/test-frame` | `{"kind": "white" \| "black" \| "grid"}` | `{"ok": true}`. 409 if the output window isn't connected |

## Camera

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/projector` | `{"key": "..."}` | Chooses which display is the projector (a `key` from `hardware.displays`) and saves the choice; returns status. 404 for an unknown display |
| POST | `/api/camera` | `{"unique_id": "..."}` | Selects a camera and saves the choice; returns status. 404 for an unknown camera |
| GET | `/api/camera/preview.jpg` | | A JPEG frame, downscaled to 1280 px wide. 409 if no camera is selected or a scan is running |
| POST | `/api/camera/release` | | Closes the camera. 409 while scanning |
| POST | `/api/camera/calibrate` | | Shows white on the output and runs the exposure search; returns `{"exposure", "gain", "p99"}`. 409 without a USB webcam or output window, 422 if calibration fails |

## Scan

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/scan` | | 202 `{"started": true}`; the scan runs in the background and reports over the WebSocket. 409 if the rig isn't ready, the camera isn't a USB webcam, or a scan is already running |
| POST | `/api/scan/cancel` | | `{"cancelling": true}`. 409 if no scan is running |
| GET | `/api/scan/latest` | | The last scan's summary (`meta.json`): size, coverage, seconds, bit reliability, detected surfaces, warnings, plus an `image` URL. 404 before the first scan |
| GET | `/api/scan/latest.png` | | The scan image in projector pixels |
| GET | `/api/scan/latest-mask.png` | | The decoded-pixel mask |

## Scene

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/scene` | | The scene: size, surfaces, selected id, presentation state, `scan_rev`. 404 before the first scan |
| PATCH | `/api/scene/surfaces/{id}` | Any of `effect`, `params`, `polygon` (3+ `[x, y]` points), `name` (up to 80 characters), `bezier` (the editor's curve data, sent together with its flattened `polygon`) | Updates one surface. Changing `effect` resets `params`; changing `polygon` marks a detected surface as edited, and drops any stored `bezier` unless a new one is sent with it |
| DELETE | `/api/scene/surfaces/{id}` | | Removes a surface |
| POST | `/api/scene/surfaces` | `{"polygon": [[x, y], ...], "name"?: "..."}` | Adds a hand-drawn surface and selects it |
| POST | `/api/scene/select` | `{"id": 3}` or `{"id": null}` | Selects or deselects a surface |
| POST | `/api/scene/merge` | `{"ids": [3, 5, ...]}` (2 or more) | Merges surfaces into the first one |
| POST | `/api/scene/apply` | `{"from": 3, "to"?: [5, 6]}` | Copies a surface's effect and params to the listed surfaces, or to all of them if `to` is omitted |
| POST | `/api/scene/redetect` | | Reruns detection on the saved scan, keeping drawn and edited surfaces. 404 before a scan, 409 while scanning |

Routes that name a surface return 404 for an unknown surface id.

## Presentation

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/presentation` | `{"mode"?: "edit" \| "play", "blackout"?: bool}` | The presentation state |
| POST | `/api/presentation/blackout/toggle` | | The presentation state |

Presentation state is per engine session and isn't saved with the scene.

## Media

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/media?name=<original filename>` | The raw file | `{"name", "url", "kind": "image" \| "video"}`. 400 for an empty file, 413 over 2 GB, 415 for an unsupported type |
| GET | `/api/media/{name}` | | The stored file, with Range support for video. 404 for unknown names |

Accepted extensions: png, jpg, jpeg, webp, gif, mp4, m4v, mov, webm. Stored names are `<slug>-<12-hex-hash>.<ext>`.

## Projects

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/projects` | | Saved projects, newest first |
| POST | `/api/projects` | `{"name": "..."}` (1 to 80 characters) | Saves the working scan and scene under that name, overwriting a project with the same slug. 409 before the first scan or while scanning |
| POST | `/api/projects/{slug}/open` | | Replaces the working scan with the project's and switches to Play. 404 for an unknown project, 409 while scanning |

## WebSocket: `/ws`

The first message from a client must be a hello; otherwise the engine closes the socket with code 1008.

- Editor: `{"type": "hello", "role": "editor"}`
- Output: `{"type": "hello", "role": "output", "width": W, "height": H}`. The output sends it again when it is resized (for example on going fullscreen). A newer output window replaces the previous one.

**Engine to editors:** `status`, `scene`, `scan_started`, `scan_progress` (`done`, `total`), `scan_result` (the scan summary plus `image`), `scan_failed` (`error`), `scan_cancelled`, `scan_reload` (refetch the scan after a redetect or project open), `effect_error` (`surface`, `effect`, `log`).

**Engine to output:** `scene`, `show_test_frame` (`kind`), `show_pattern` (`seq`, `pattern`).

**Output to engine:** `pattern_shown` (`seq`, the ack for `show_pattern`), `output_stats` (`fps`, every 2 seconds), `effect_error` (forwarded to editors), and `hello` on resize.
