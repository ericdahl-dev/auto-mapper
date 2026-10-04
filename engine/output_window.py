"""The engine's view of the output window (#145): which window it is, its size, and what it reports
(frame rate, sound). ADR-0001: the output window owns the projector; this is only what the engine
knows about it, kept from its hello, stats and disconnect messages, for status and scans.
"""

from engine.messages import OutputStats

TEXT_MAX = 200  # an error from the window is cut to this for the editor


class OutputWindow:
    def __init__(self):
        self.ws: object | None = None  # the window's websocket; a newer window replaces it
        self._forget()

    def _forget(self) -> None:
        self.resolution: dict | None = None
        self.fps: float | None = None
        self.sound: dict | None = None  # its sound meter: {"level", "error"}
        self.video_sound_blocked = False  # a video should be heard but waits for a click
        self.sound_output_error: str | None = None  # the chosen sound output couldn't be used
        self.sound_channels: int | None = None  # channels the sound output has (2 for most)

    def hello(self, ws: object, width: int, height: int) -> bool:
        """A window says hello (again on every resize). True when it's a new window, which should be
        sent the show; a newer window replaces the old one, since only one owns the projector."""
        first = ws is not self.ws
        self.ws = ws
        self.resolution = {"width": width, "height": height}
        return first

    def stats(self, msg: OutputStats) -> None:
        if msg.fps is not None:
            self.fps = round(msg.fps, 1)
        if "sound_output_error" in msg.model_fields_set:  # absent: unchanged; null: cleared
            self.sound_output_error = (msg.sound_output_error or "")[:TEXT_MAX] or None
        if msg.sound_channels is not None:
            self.sound_channels = msg.sound_channels
        if msg.video_sound_blocked is not None:
            self.video_sound_blocked = msg.video_sound_blocked
        if msg.sound is not None:
            self.sound = {
                "level": round(min(1.0, max(0.0, msg.sound.level)), 3),
                "error": (msg.sound.error or "")[:TEXT_MAX] or None,
            }

    def gone(self, ws: object) -> bool:
        """A websocket closed. True if it was this window: everything it reported is forgotten."""
        if ws is not self.ws:
            return False
        self.ws = None
        self._forget()
        return True

    def fills(self, projector: dict | None) -> bool:
        """Fullscreen on the projector: patterns are drawn at the projector's size, so a scan needs it."""
        return (self.resolution is not None and projector is not None
                and self.resolution == {"width": projector["width"], "height": projector["height"]})

    def status(self) -> dict:
        return {
            "output_connected": self.ws is not None,
            "output_resolution": self.resolution,
            "output_fps": self.fps,
            "output_sound": self.sound,
            "output_video_sound_blocked": self.video_sound_blocked,
            "output_sound_output_error": self.sound_output_error,
            "output_sound_channels": self.sound_channels,
        }
