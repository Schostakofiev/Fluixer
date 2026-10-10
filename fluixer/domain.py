"""Future simulation boundary, intentionally free of machine/export settings.

These contracts are not yet populated from GH. Coordinate and length units must
be declared by the geometry backend; no GH exporter value is treated as length.
"""
from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass(frozen=True)
class FluidInterval:
    phase: Literal['gas', 'liquid']
    start: float
    end: float
    original_length: float
    compensated_length: float


@dataclass(frozen=True)
class SimulationResult:
    length_unit: str
    intervals: tuple[FluidInterval, ...]


class SimulationBackend(Protocol):
    def simulate(self, geometry: object, pattern: object) -> SimulationResult:
        """Return physical intervals; rendering and CSV consume separate views."""
        ...
