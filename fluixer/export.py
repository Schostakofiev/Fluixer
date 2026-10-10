"""Final machine CSV boundary; never imported by simulation or calibration."""
import csv
import math
from dataclasses import dataclass

HEADER = ('type', 'motor', 'direction', 'steps', 'speed', 'unit', 'seconds')


@dataclass(frozen=True)
class MachineParameters:
    speed: float = 400
    k_gas: float = 606
    k_liquid: float = 625


def build_rows(values, liquid_gas, machine=MachineParameters(), unit='steps'):
    """Accept GH exporter-boundary values, in execution order (already reversed).

    k values are manual adjustments with the existing multiplicative k/625
    interpretation. Input physical units remain unresolved; do not assume mm/ms.
    Preserve fractional steps, integer truncation of speed/k, minimum one,
    and per-input splitting. Additional validation rejects malformed input.
    """
    unit = str(unit).strip().lower()
    if unit not in ('steps', 'segments'):
        raise ValueError('unit must be steps or segments')
    values, phases = list(values), list(liquid_gas)
    if len(values) != len(phases):
        raise ValueError('values and liquid_gas must have equal lengths')
    for value in (machine.speed, machine.k_gas, machine.k_liquid):
        if not math.isfinite(float(value)) or float(value) < 0:
            raise ValueError('machine parameters must be finite and nonnegative')
    rows = []
    for value, phase in zip(values, phases):
        value = float(value)
        if not math.isfinite(value) or value < 0:
            raise ValueError('input values must be finite and nonnegative')
        if float(phase) not in (0, 1):
            raise ValueError('phase must be 0 (gas) or 1 (liquid)')
        phase = int(float(phase))
        k = int(machine.k_gas if phase == 0 else machine.k_liquid)
        total = value * float(k) / 625
        if not math.isfinite(total):
            raise ValueError('command value overflow')
        if total < 1:
            total = 1
        if unit == 'segments':
            total = max(1, int(total * 3 / 200 + 0.5))
        limit = 2000 if unit == 'steps' else 89
        # Prevent accidental unbounded materialization in the standalone API.
        if len(rows) + math.ceil(total / limit) > 1_000_000:
            raise ValueError('export exceeds one million rows')
        while total > 0:
            amount = min(total, limit)
            rows.append(['move', 'g' if phase == 0 else 'l', 'fwd',
                         amount, int(machine.speed), unit, ''])
            total -= amount
    return rows


def write_csv(path, rows):
    """Match GH CSV header, UTF-8 BOM and CRLF line endings."""
    with open(path, 'w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.writer(stream)
        writer.writerow(HEADER)
        writer.writerows(rows)
