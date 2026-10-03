# Engine HTTP and WebSocket API

The engine (`engine/app.py`) serves on `http://127.0.0.1:8765`. In development, the Vite server on `:5173` proxies `/api` and `/ws` to it, so the editor and output pages use same-origin URLs. Request and message shapes are defined in `engine/messages.py` and mirrored in `frontend/src/shared/messages.ts`.

This is an internal API between the engine and its two pages, not a stable public one. Errors come back as FastAPI's `{"detail": "..."}` with the status codes listed below.

Most write routes respond with the updated show, and the show is broadcast over the WebSocket, so every editor and the output window stay in sync.

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
| GET | `/api/camera/scan-settings` | | The selected camera's scan settings: `{"hole_fill": 9, "hdr": 1, "mask": null}`. 404 with no camera |
| POST | `/api/camera/scan-settings` | `{"hole_fill"?: 0..31, "hdr"?: 1..3, "mask"?: [[[x, y], ...], ...], "clear_mask"?: true}` | Changes them for the selected camera (saved with its calibration in settings.json); the next scan uses them. `hole_fill`: how wide a gap between decoded pixels is filled (0 = none). `mask`: areas of the camera image to scan (up to 16 shapes of 3+ points, 0..1 camera coordinates); everything outside is ignored. `clear_mask`: scan the whole image again. `hdr`: 1 (off), 2 or 3 exposures per pattern, the calibrated one plus longer ones (x4; x3 and x9) capped at the camera's limit, merged per pixel |
| POST | `/api/camera/calibrate` | | Shows white on the output and runs the exposure search; returns `{"exposure", "gain", "p99"}`. 409 without a USB webcam or output window, 422 if calibration fails |

## Scan

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/scan` | | 202 `{"started": true}`; the scan runs in the background and reports over the WebSocket. 409 if the rig isn't ready, the camera isn't a USB webcam, or a scan is already running |
| POST | `/api/scan/cancel` | | `{"canceling": true}`. 409 if no scan is running |
| GET | `/api/scan/latest` | | The last scan's summary (`meta.json`): size, coverage, seconds, bit reliability, detected surfaces, warnings, plus an `image` URL. 404 before the first scan |
| GET | `/api/scan/latest.png` | | The scan image in projector pixels |
| GET | `/api/scan/latest-mask.png` | | The decoded-pixel mask |

## Show

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/show` | | The current show: size, surfaces, selected id, presentation state, `scan_rev`. 404 before the first scan |
| PATCH | `/api/show/surfaces/{id}` | Any of `effect`, `params`, `polygon` (3+ `[x, y]` points), `name` (up to 80 characters), `bezier` (the editor's curve data, sent together with its flattened `polygon`), `edge` (-10..10 px: shrink or grow the lit area past the outline), `gesture` (an id: PATCHes sharing one are one undo step, e.g. a whole drag) | Updates one surface. Changing `effect` resets `params`; changing `polygon` marks a detected surface as edited, and drops any stored `bezier` unless a new one is sent with it |
| DELETE | `/api/show/surfaces/{id}` | | Removes a surface |
| POST | `/api/show/surfaces` | `{"polygon": [[x, y], ...], "name"?: "..."}` | Adds a hand-drawn surface and selects it |
| POST | `/api/show/select` | `{"id": 3}` or `{"id": null}` | Selects or deselects a surface |
| POST | `/api/show/delete` | `{"ids": [2, 5]}` | Deletes several surfaces as one undo step; 404 (and nothing deleted) if any id is unknown |
| POST | `/api/show/merge` | `{"ids": [3, 5, ...]}` (2 or more) | Merges surfaces into the first one |
| POST | `/api/show/apply` | `{"from": 3, "to"?: [5, 6]}` | Copies a surface's effect and params to the listed surfaces, or to all of them if `to` is omitted |
| POST | `/api/show/redetect` | | Reruns detection on the saved scan, keeping drawn and edited surfaces. 404 before a scan, 409 while scanning |
| POST | `/api/show/alignment` | `{"corners"?: [[x,y]×4], "brightness"?: 0..1}` | Realigns the whole show (where the output's TL, TR, BR, BL go) and sets the master brightness. Saved with the show; a new scan drops the corners, keeps brightness. 404 before a scan |
| POST | `/api/show/scenes` | `{"name"?: "Night", "duplicate"?: 1}` | Adds a scene and opens it: dark, or a copy of another scene's effects and settings. Outlines (and their edge) are shared by every scene; effects and settings belong to each |
| PATCH | `/api/show/scenes/{id}` | `{"name"?: "Night", "duration"?: 12.5}` | Renames a scene or sets how long it plays in the playlist (seconds, 0..3600) |
| POST | `/api/show/scenes/{id}/open` | | Shows and edits that scene. Not an undo step |
| POST | `/api/show/scenes/next`, `/api/show/scenes/previous` | | Opens the next or previous scene in the playlist; wraps around only if the playlist loops |
| POST | `/api/show/playlist` | `{"crossfade"?: 1.5, "loop"?: true}` | Playlist settings: seconds the output blends one scene into the next (0..60), and whether it starts over after the last. In Play mode the engine opens each scene after the previous one's duration |
| POST | `/api/show/scenes/order` | `{"ids": [3, 1, 2]}` | Playlist order; must list every scene once (422 otherwise) |
| DELETE | `/api/show/scenes/{id}` | | Deletes a scene; deleting the open one opens the next. 409 for the last scene |
| PUT | `/api/show/midi` | `{"bindings": [{"kind": "cc" or "note", "channel": 0..15, "number": 0..127, "target": {"surface": 2, "param": "zoom"} or {"action": "play", "edit", "blackout", "next" or "previous"}}]}` | MIDI bindings, saved with the show (so each project has its own). The Editor learns them and does the MIDI itself (Web MIDI); the engine only stores them |
| POST | `/api/show/undo` | | Undoes the last show change (surfaces, effects, settings, alignment; not selection, Play/Blackout or sound). The show message's `history` names what Undo and Redo would do. 409 when there's nothing to undo. Up to 100 steps; a new scan or opening a project clears them |
| POST | `/api/show/redo` | | Redoes the last undone change; any new change clears redo. 409 when there's nothing to redo |
| POST | `/api/show/alignment/reset` | | Back to the projector's own corners at full brightness |

Routes that name a surface return 404 for an unknown surface id.

## Presentation

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/sound` | `{"enabled"?: bool, "device"?: "...", "source"?: "mic" \| "video", "output"?: "..."}` | Sound-reactive effects on or off, the browser input device id, whether they follow the microphone or the videos' own sound, and the audio output device for video sound (`""` = the Mac's default); pushed to the output in the scene's `sound` field. Returns the sound settings |
| POST | `/api/sound` | `{"delay": 120}` | Sound delay, −500..500 ms. Positive holds video sound back so it lands with the projector's late picture; negative plays it early for speakers that play late (Bluetooth, an AV receiver), from a hidden copy of each video running ahead of the picture. Saved in settings.json (it belongs to the setup, so it survives restarts) |
| GET | `/api/presentation` | | `{"mode": "edit" or "play", "blackout": bool}` |
| GET | `/api/schedule` | | `{"schedule": {...}, "next": {"at": "2026-10-05T17:30:00", "on": true} or null, "autostart": bool}` (local time) |
| POST | `/api/schedule` | `{"enabled": true, "on": "17:30", "off": "23:00", "days"?: {"5": {"on": "12:00", "off": "23:30"}, "6": null}}` | Daily on/off times: Play between them, Blackout outside. `days` overrides a weekday ("0" = Monday), `null` = off all day. An off time at or before the on time runs past midnight. Applied only when its state changes, so switching by hand holds until the next change. Saved in settings.json |
| POST | `/api/autostart` | `{"enabled": true}` | When the engine starts, go straight to Play with the last show |
| POST | `/api/presentation` | `{"mode"?: "edit" \| "play", "blackout"?: bool}` | The presentation state |
| POST | `/api/presentation/blackout/toggle` | | The presentation state |

Presentation state, sound settings and the selected surface are per engine session and aren't saved with the show.

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
| POST | `/api/projects` | `{"name": "..."}` (1 to 80 characters) | Saves the working scan and show under that name, overwriting a project with the same slug. 409 before the first scan or while scanning |
| POST | `/api/projects/new` | | Starts over: clears the working scan, its show and media, and the open project; Play/Blackout back to Edit. Saved projects are kept. Editors get `show_cleared` (and start empty); the output goes dark. 409 while scanning |
| POST | `/api/projects/{slug}/open` | | Replaces the working scan with the project's and switches to Play. 404 for an unknown project, 409 while scanning |

## WebSocket: `/ws`

The first message from a client must be a hello; otherwise the engine closes the socket with code 1008.

- Editor: `{"type": "hello", "role": "editor"}`
- Output: `{"type": "hello", "role": "output", "width": W, "height": H}`. The output sends it again when it is resized (for example on going fullscreen). A newer output window replaces the previous one.

**Engine to editors:** `status`, `show`, `scan_started`, `scan_progress` (`done`, `total`), `scan_result` (the scan summary plus `image`), `scan_failed` (`error`), `scan_canceled`, `scan_reload` (refetch the scan after a redetect or project open), `effect_error` (`surface`, `effect`, `log`).

**Engine to output:** `show`, `show_test_frame` (`kind`), `show_pattern` (`seq`, `pattern`).

**Output to engine:** `pattern_shown` (`seq`, the ack for `show_pattern`), `output_stats` (`fps`, and `sound` {`level`, `error`}; every 2 seconds, or 4 times a second while listening; relayed to editors as `output_sound` in status; plus `video_sound_blocked` and `sound_output_error`, relayed as `output_video_sound_blocked` and `output_sound_output_error`), `effect_error` (forwarded to editors), and `hello` on resize.

## OSC

Off by default. Turn it on with `POST /api/osc` `{"enabled": true, "port": 9000}` (saved in settings.json; `GET /api/osc` says which port is listening). Then send OSC over UDP to that port, for example from QLab, TouchOSC or Bitfocus Companion (Stream Deck). Unknown addresses and bad values are ignored, so a controller can never stop the show.

| Address | Arguments | Does |
|---|---|---|
| `/play` | | Play mode |
| `/edit` | | Edit mode |
| `/blackout` | `1` or `0`, or none to toggle | Blackout on or off |
| `/scene/next`, `/scene/previous` | | Steps through the playlist (wraps only if it loops) |
| `/scene/open` | scene id or name | Opens a scene |
| `/project/open` | project name or slug | Opens a saved project, in Play |
| `/surface/<id>/effect` | effect id, e.g. `media` | Changes a surface's effect (its settings reset) |
| `/surface/<id>/param/<name>` | a number, string or color | Sets one setting of the surface's effect. Numbers are clamped to the setting's range and choices must be one of its options, as in the Editor (ranges come from `engine/effect_settings.json`, recorded from the frontend's effects) |

Stream Deck: Bitfocus Companion's generic OSC module can send any of these, or its HTTP module can call the routes above; nothing Stream Deck-specific is needed.

