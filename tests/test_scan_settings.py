import json

from engine.cameras import CameraSettings
from engine.scan_settings import ScanSettings


def test_settings_saved_by_other_versions_still_load(tmp_path):
    """Older files lack newer settings (they take their defaults); newer files may have ones this
    version doesn't know (dropped, not an error)."""
    (tmp_path / "settings.json").write_text(json.dumps(
        {"scan_settings": {"cam": {"hole_fill": 4, "hdr": 2, "from_the_future": True}}}))
    s = CameraSettings(tmp_path).scan_settings("cam")
    assert s == ScanSettings(hole_fill=4, hdr=2, mask=None, aperture="8")


def test_aperture_camera_leaves_the_lens_as_set():
    assert ScanSettings(aperture="camera").still_aperture is None
    assert ScanSettings().still_aperture == "8"
