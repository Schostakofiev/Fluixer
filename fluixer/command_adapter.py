"""Convert physical liquid/gas intervals into machine commands after simulation."""
from .gh_compat import prepare_export_branch
from .export import MachineParameters, build_rows


def display_rows(display, *, machine=MachineParameters(), unit='steps',
                 pre_add=730, length_per_100_steps=9.65):
    """Export any endpoint phases using the same policy for every pattern.

    Preserve GH precision, reverse injection order and omit the terminal gas
    tail. Zero-length placeholders adapt liquid endpoints to the numeric GH
    helper; they are not physical requirements on the simulated sequence.
    """
    sequence = display.sequence
    segments = sequence.segments
    if sequence.length_unit != 'mm':
        raise ValueError('GH command calibration requires lengths in mm')
    if any(s.phase not in ('gas', 'liquid') for s in segments):
        raise ValueError('Segment phase must be gas or liquid')
    if not any(s.phase == 'liquid' for s in segments):
        raise ValueError('No liquid intervals to export')

    lengths = [s.length for s in segments]
    phases = [int(s.phase == 'liquid') for s in segments]
    leading_placeholder = phases[0] == 1
    if leading_placeholder:
        lengths.insert(0, 0.0)
        phases.insert(0, 0)
    if phases[-1] == 1:
        # The GH helper removes its last item; protect real terminal liquid.
        lengths.append(0.0)
        phases.append(0)
    branch = prepare_export_branch(
        (0,), lengths, phases[:-1], pre_add=pre_add,
        length_per_100_steps=length_per_100_steps,
    )
    values, liquid_gas = branch.values, branch.liquid_gas
    if leading_placeholder and values[-1] == 0:
        # build_rows enforces a minimum of one unit: never pass a synthetic
        # zero gas interval to it when there is no Pre-Add to inject.
        values, liquid_gas = values[:-1], liquid_gas[:-1]
    return build_rows(values, liquid_gas, machine, unit)
