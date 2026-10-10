"""Extracted scalar formula only, not the complete GH calibration network."""
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class CircumferenceCorrection:
    scale: float
    base: float
    difference: float


def circumference_correction(r_base, diameter, d, x):
    if not all(math.isfinite(v) for v in (r_base, diameter, d, x)):
        raise ValueError('calibration inputs must be finite')
    if d - x / 2 == 0 or d + x / 2 == 0:
        raise ValueError('singular calibration parameters')
    scale = (d + x / 2) / (d - x / 2)
    base = math.pi * 2 * (r_base + diameter / 2)
    return CircumferenceCorrection(scale, base, base - base / (scale * scale))
