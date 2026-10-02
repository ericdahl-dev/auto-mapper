"""#72: a saved scan on disk is owned by one module, the scan folder."""

import cv2
import numpy as np
import pytest

from engine.scan import GrayDecoder, block_coverage, pattern_sequence, projector_space_image
from engine.scan_folder import NoScan, ScanFolder
from engine.surfaces import detect_surfaces
from tests.synthetic import Scene

W, H = 256, 144


@pytest.fixture(scope="module")
def decoded():
    """A synthetic scan of a wall and a box (decoded patterns, scan image, coverage)."""
    scene = Scene(proj_w=W, proj_h=H)
    dec = GrayDecoder(W, H)
    for p in pattern_sequence(W, H):
        dec.add(p, scene.frame(p))
    result = dec.result()
    image, covered = projector_space_image(result)
    return result, image, covered


def summary(result, image, covered) -> dict:
    return {"width": W, "height": H, "coverage": block_coverage(covered),
            "surfaces": detect_surfaces(result, (image, covered))}


def test_an_empty_folder_has_no_scan(tmp_path):
    folder = ScanFolder(tmp_path / "latest")
    assert not folder.has_scan()
    assert folder.meta() is None
    assert folder.image_path() is None and folder.mask_path() is None
    with pytest.raises(NoScan):
        folder.redetect()


def test_saving_a_scan_keeps_its_image_mask_and_summary(tmp_path, decoded):
    result, image, covered = decoded
    folder = ScanFolder(tmp_path / "latest")
    folder.save(result, image, covered, summary(result, image, covered))

    assert folder.has_scan()
    assert folder.meta()["width"] == W and len(folder.meta()["surfaces"]) >= 2
    assert np.array_equal(cv2.imread(str(folder.image_path())), image)
    assert (cv2.imread(str(folder.mask_path()), cv2.IMREAD_GRAYSCALE) > 0).sum() == covered.sum()


def test_redetecting_reruns_detection_on_the_saved_scan(tmp_path, decoded):
    result, image, covered = decoded
    folder = ScanFolder(tmp_path / "latest")
    meta = summary(result, image, covered)
    expected = meta["surfaces"]
    folder.save(result, image, covered, {**meta, "surfaces": []})  # as if detection had found nothing

    again = folder.redetect()

    assert again["surfaces"] == expected
    assert folder.meta()["surfaces"] == expected  # saved
    assert again["coverage"] == meta["coverage"]  # the rest of the summary is kept


def test_copying_a_scan_takes_everything_a_project_needs(tmp_path, decoded):
    result, image, covered = decoded
    latest = ScanFolder(tmp_path / "latest")
    latest.save(result, image, covered, summary(result, image, covered))
    latest.show_file.write_text('{"surfaces": []}')  # the current show is saved alongside its scan
    latest.media_dir.mkdir()
    (latest.media_dir / "wall-0123456789ab.png").write_bytes(b"png")
    (latest.media_dir / "upload.part").write_bytes(b"half")  # an upload still in progress

    copy = latest.copy_to(tmp_path / "projects" / "porch")
    assert copy.has_scan() and copy.show_file.read_text() == '{"surfaces": []}'
    assert [p.name for p in copy.media_dir.iterdir()] == ["wall-0123456789ab.png"]  # no half uploads
    assert copy.redetect()["surfaces"] == latest.meta()["surfaces"]

    restored = ScanFolder(tmp_path / "elsewhere")
    restored.media_dir.mkdir(parents=True)
    (restored.media_dir / "old.mp4").write_bytes(b"old")  # media from before must not linger
    restored.replace_with(copy)
    assert restored.has_scan() and restored.show_file.exists()
    assert [p.name for p in restored.media_dir.iterdir()] == ["wall-0123456789ab.png"]
