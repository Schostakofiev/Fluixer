"""Explicit physical-length to export-boundary conversion, downstream of simulation.

Matches GH #243 -> #222 (x/100) -> #114 -> #126/#127.
Calibration and pre-add must already have been applied to the input lengths.
Reverse each GH branch independently; never reverse a flattened tree.
"""
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class ExecutionBranch:
    path: tuple[int, ...]
    values: tuple[float, ...]
    liquid_gas: tuple[int, ...]


def convert_length_branch(path, lengths, liquid_gas, length_per_100_steps):
    """Lengths and calibration distance must use the same explicit model unit.

    No speed, manual k adjustment or Steps/Segments selector belongs here.
    Input is GH #73 Length + #170 phase order, not #205 execution order.
    """
    lengths, phases = tuple(lengths), tuple(liquid_gas)
    if len(lengths) != len(phases):
        raise ValueError('lengths and phases must have equal lengths per branch')
    distance = float(length_per_100_steps)
    if not math.isfinite(distance) or distance <= 0:
        raise ValueError('length per 100 steps must be positive and finite')
    values = tuple(float(x) for x in lengths)
    if any(not math.isfinite(x) or x < 0 for x in values):
        raise ValueError('lengths must be finite and nonnegative')
    if any(float(x) not in (0, 1) for x in phases):
        raise ValueError('phase must be 0 or 1')
    # Preserve GH operation order: divide by (distance/100), not length*100/distance.
    divisor = distance / 100
    if divisor == 0:
        raise ValueError('conversion divisor underflow')
    converted = tuple(x / divisor for x in values)
    if any(not math.isfinite(x) for x in converted):
        raise ValueError('converted value overflow')
    return ExecutionBranch(tuple(path), converted[::-1], tuple(int(float(x)) for x in phases)[::-1])
