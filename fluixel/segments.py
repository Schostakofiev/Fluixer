"""Physical intervals on a path; no speed, k, steps or export-unit dependency.

The input is explicit liquid windows in true distance along the path. The GH
contour/Brep-to-window solver is not replaced by this module.
"""
from dataclasses import dataclass
from .geometry import TubePath, finite


@dataclass(frozen=True)
class PhysicalSegment:
    phase: str
    start_distance: float
    end_distance: float

    @property
    def length(self):
        return self.end_distance-self.start_distance


@dataclass(frozen=True)
class PhysicalSequence:
    length_unit: str
    segments: tuple[PhysicalSegment, ...]


def partition_path(path: TubePath, liquid_windows):
    """Partition a path into gas/liquid, merging touching or overlapping windows.

    Windows must be ordered endpoints in [0, path.length]. Input order may vary.
    Zero-length windows contribute no liquid. No tolerance-dependent erasure.
    """
    windows = []
    for start,end in liquid_windows:
        start,end = finite(start,'window start'),finite(end,'window end')
        if not 0 <= start <= end <= path.length:
            raise ValueError('liquid window is outside path or reversed')
        if start < end:
            windows.append((start,end))
    merged = []
    for start,end in sorted(windows):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0],max(merged[-1][1],end))
        else:
            merged.append((start,end))
    segments, position = [], 0.0
    for start,end in merged:
        if start > position:
            segments.append(PhysicalSegment('gas',position,start))
        segments.append(PhysicalSegment('liquid',start,end))
        position = end
    if position < path.length:
        segments.append(PhysicalSegment('gas',position,path.length))
    return PhysicalSequence(path.length_unit,tuple(segments))
