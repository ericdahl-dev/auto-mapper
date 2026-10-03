"""A camera's scan settings (#66, #144): what each one means, its default and its bounds, in one place.

Kept per camera with its calibration (CameraSettings); a scan reads them once as it starts, so a change
made while it runs applies to the next one.
"""

from dataclasses import asdict, dataclass, fields, replace

HOLE_FILL_MAX = 31  # px
HDR_MAX = 3  # exposures per pattern
APERTURE_PATTERN = r"^(\d{1,2}(\.\d)?|camera)$"  # an f-number ("8" = f/8), or "camera"
MASK_MAX_AREAS = 16
MASK_MAX_POINTS = 200


@dataclass(frozen=True)
class ScanSettings:
    hole_fill: int = 9  # px gap between decoded pixels the scan fills in (0 = none)
    hdr: int = 1  # exposures per pattern: 1 = off
    mask: list | None = None  # areas of the camera image to scan (0..1 coordinates); None = all of it
    aperture: str = "8"  # still cameras: the f-number to scan at (f/8: deep focus), or "camera": as set

    @classmethod
    def from_saved(cls, saved: dict) -> "ScanSettings":
        """From settings.json: missing values take their defaults, ones this version doesn't know are dropped."""
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in saved.items() if k in known})

    def changed(self, changes: dict) -> "ScanSettings":
        return replace(self, **changes)

    @property
    def still_aperture(self) -> str | None:
        """The f-number a still camera scans at; None leaves the lens as set."""
        return None if self.aperture == "camera" else self.aperture

    def to_dict(self) -> dict:
        return asdict(self)
