"""#145: the engine's view of the output window, without a websocket."""

from engine.messages import OutputStats
from engine.output_window import OutputWindow

WS, OTHER = object(), object()
PROJECTOR = {"width": 1920, "height": 1080}


def stats(**fields) -> OutputStats:
    return OutputStats(type="output_stats", **fields)


def test_reports_what_the_output_window_says_tidied_for_the_editor():
    w = OutputWindow()
    w.hello(WS, 1920, 1080)
    w.stats(stats(fps=59.94, sound={"level": 1.7, "error": "x" * 500}, sound_channels=6, video_sound_blocked=True))
    s = w.status()
    assert s["output_connected"] and s["output_resolution"] == PROJECTOR
    assert s["output_fps"] == 59.9
    assert s["output_sound"] == {"level": 1.0, "error": "x" * 200}  # clamped, cut short
    assert (s["output_sound_channels"], s["output_video_sound_blocked"]) == (6, True)


def test_a_sound_output_error_stays_until_the_window_clears_it():
    w = OutputWindow()
    w.hello(WS, 1920, 1080)
    w.stats(stats(sound_output_error="That sound output is not available."))
    w.stats(stats(fps=60))  # says nothing about it: kept
    assert w.status()["output_sound_output_error"] == "That sound output is not available."
    w.stats(stats(sound_output_error=None))  # says it's fine now
    assert w.status()["output_sound_output_error"] is None


def test_forgets_everything_when_its_window_goes_but_not_for_an_old_one():
    w = OutputWindow()
    w.hello(WS, 1920, 1080)
    w.stats(stats(fps=60, video_sound_blocked=True))
    assert not w.gone(OTHER)  # not the current window: nothing changes
    assert w.gone(WS)
    s = w.status()
    assert not s["output_connected"] and s["output_resolution"] is None and s["output_fps"] is None
    assert s["output_video_sound_blocked"] is False


def test_fills_the_projector_only_at_its_exact_size():
    w = OutputWindow()
    assert not w.fills(PROJECTOR)
    w.hello(WS, 1920, 927)
    assert not w.fills(PROJECTOR)
    w.hello(WS, 1920, 1080)
    assert w.fills(PROJECTOR) and not w.fills(None)


def test_knows_a_reconnecting_window_from_a_resize():
    w = OutputWindow()
    assert w.hello(WS, 800, 600)  # first hello: send it the show
    assert not w.hello(WS, 1920, 1080)  # the same window going fullscreen
    assert w.hello(OTHER, 1920, 1080)  # a newer window replaces it
