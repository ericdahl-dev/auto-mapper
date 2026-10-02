# The output window owns the projector, including during scans

The browser output window, fullscreen on the projector, draws everything the projector shows: scan patterns, test frames and effects. The engine never opens its own fullscreen window. During a scan the engine and the output window work in lockstep: the engine asks for a pattern, the output window draws it and acknowledges after two animation frames, and only then does the engine wait its settle time and capture. A native window from the engine (OpenCV or pyobjc) would have avoided the round-trip, but it would fight the browser for the projector, need a second rendering path for patterns, and break the "one thing on the projector" model that lets playback, scans and test frames switch without moving windows.

## Consequences

- A scan needs the output window connected and filling the projector exactly. Scan stays disabled otherwise.
- A hidden or minimized output window stops drawing, so a missing acknowledgment aborts the scan rather than letting it hang.
- Patterns are generated in the output window, mirroring the engine's pattern definition, and the two must stay in step.
