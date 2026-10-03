"""Plays the show's scenes in order while the output is in Play mode, each for its duration.

Moves on by opening the next scene, as Next would; the output crossfades between them. A scene
opened any other way (by hand, Next, Previous) gets its full duration from then on.
"""

import asyncio
import time

from engine.show import CurrentShow


class PlaylistRunner:
    def __init__(self, show: CurrentShow):
        self.show = show
        self._wake = asyncio.Event()
        self._loop = asyncio.get_running_loop()
        self._scene: int | None = None  # the scene being timed, and since when
        self._since = 0.0
        show.subscribe(lambda: self._loop.call_soon_threadsafe(self._wake.set))

    def _timing(self) -> float | None:
        """Seconds until the open scene is done, or None when nothing should move on by itself."""
        data = self.show.data
        playing = self.show.presentation["mode"] == "play"
        if not data or not playing or len(data["scenes"]) < 2:
            self._scene = None
            return None
        if data["scene"] != self._scene:
            self._scene, self._since = data["scene"], time.monotonic()
        duration = next(sc["duration"] for sc in data["scenes"] if sc["id"] == data["scene"])
        return self._since + duration - time.monotonic()

    async def run(self) -> None:
        while True:
            self._wake.clear()
            left = self._timing()
            if left is not None and left <= 0:
                self._scene = None  # time the next scene from when it opens
                self.show.step_scene(1)
                continue
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=left)
            except TimeoutError:
                pass
