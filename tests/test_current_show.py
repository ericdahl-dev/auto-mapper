"""#73: one owner for the current show. Changes announce themselves; selection is session state."""

import json

import pytest

from engine.projects import ProjectStore
from engine.scan_folder import ScanFolder
from engine.scene import SceneStore

WALL = {"polygon": [[0, 0], [100, 0], [100, 50], [0, 50]], "area": 5000.0}
BOX = {"polygon": [[10, 10], [30, 10], [30, 30], [10, 30]], "area": 400.0}
SQUARE = [[40, 10], [60, 10], [60, 30], [40, 30]]


@pytest.fixture
def folder(tmp_path):
    folder = ScanFolder(tmp_path / "scans" / "latest")
    folder.path.mkdir(parents=True)
    folder.meta_file.write_text(json.dumps({"width": 100, "height": 50, "surfaces": [WALL, BOX]}))
    return folder


@pytest.fixture
def show(folder):
    show = SceneStore(folder)
    show.announced = 0

    def count():
        show.announced += 1

    show.subscribe(count)
    return show


def test_every_change_announces_itself_once(show):
    changes = [
        lambda: show.update(1, effect="fill"),
        lambda: show.update(1, params={"brightness": 0.5}),
        lambda: show.add_manual(SQUARE),
        lambda: show.apply_effect(1),
        lambda: show.merge([1, 2]),
        lambda: show.select(1),
        lambda: show.present(mode="play"),
        lambda: show.set_sound(enabled=True),
        lambda: show.delete(1),
        lambda: show.apply_detection({"width": 100, "height": 50, "surfaces": [WALL]}),
    ]
    for i, change in enumerate(changes, 1):
        change()
        assert show.announced == i


def test_selecting_a_surface_is_not_saved(show, folder):
    show.update(1, effect="fill")  # saved
    saved = folder.show_file.read_text()
    show.select(2)
    assert folder.show_file.read_text() == saved  # nothing written for a click
    assert show.public()["selected"] == 2
    assert "selected" not in json.loads(saved)


def test_a_project_does_not_carry_the_selection(show, folder, tmp_path):
    projects = ProjectStore(tmp_path, folder, show)
    show.select(2)
    projects.save("Porch")
    show.select(1)
    projects.open("porch")
    assert show.public()["selected"] is None


def test_an_opened_project_starts_in_play_mode(show, folder, tmp_path):
    projects = ProjectStore(tmp_path, folder, show)
    projects.save("Porch")
    show.present(mode="edit", blackout=True)
    projects.open("porch")
    assert show.presentation == {"mode": "play", "blackout": False}


def test_surfaces_made_by_hand_are_drawn(show):
    new = show.add_manual(SQUARE)
    assert next(s for s in show.public()["surfaces"] if s["id"] == new)["source"] == "drawn"


def test_old_shows_with_manual_surfaces_load_as_drawn(folder):
    folder.show_file.write_text(json.dumps({
        "width": 100, "height": 50, "selected": 3,
        "surfaces": [{"id": 3, "name": "Mine", "polygon": SQUARE, "area": 400, "effect": "none", "params": {},
                      "source": "manual"}],
    }))
    show = SceneStore(folder)
    assert show.public()["surfaces"][0]["source"] == "drawn"
    assert show.public()["selected"] is None  # selection isn't restored from disk
