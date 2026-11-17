"""Convert physical liquid/gas intervals into machine commands after simulation."""
import math
from .geometry import finite
from .export import MachineParameters, build_rows


def _display_values(display, *, pre_add, length_per_100_steps):
    """Use real intervals in injection order, with the extension on the final gas."""
    sequence = display.sequence
    if sequence.length_unit != 'mm':
        raise ValueError('Command calibration requires lengths in mm')
    if not sequence.segments:
        raise ValueError('No pipe intervals to export')
    intervals=[]
    for segment in sequence.segments:
        if segment.phase not in ('gas', 'liquid'):
            raise ValueError('Segment phase must be gas or liquid')
        length=finite(segment.length,'segment length')
        if length<0:raise ValueError('Segment lengths must be nonnegative')
        intervals.append((length,int(segment.phase=='liquid')))
    pre_add=finite(pre_add,'Pre-Add')
    if pre_add<0:raise ValueError('Pre-Add must be nonnegative')
    distance=finite(length_per_100_steps,'100 Steps Length')
    if distance<=0:raise ValueError('100 Steps Length must be positive')
    divisor=distance/100
    if divisor==0:raise ValueError('Conversion divisor underflow')

    if any(phase for _,phase in intervals):
        # Unfilled outlet gas is not injected. A real terminal liquid is retained.
        if intervals[-1][1]==0:intervals.pop()
        intervals.reverse()
    else:
        # An empty pattern still fills the whole pipe with gas.
        intervals=[(sum(length for length,_ in intervals),0)]

    def steps(length):
        # Retain measured six-decimal boundaries and arithmetic order.
        value=float(format(length,'.6f'))/divisor
        if not math.isfinite(value):raise ValueError('Converted value overflow')
        return float(format(value,'.6f'))

    if intervals[-1][1]==0:
        length,phase=intervals[-1]
        intervals[-1]=(length+pre_add,phase)
    values=[steps(length) for length,_ in intervals]
    phases=[phase for _,phase in intervals]
    if intervals[-1][1]==1 and pre_add>0:
        extension=steps(pre_add)
        if extension>0:
            values.append(extension)
            phases.append(0)
    return tuple(values),tuple(phases)


def display_plan(display, *, machine=MachineParameters(), unit='steps',
                 pre_add=730, length_per_100_steps=9.65):
    """One command plan for CSV and Current Output; preview lengths omit Pre-Add."""
    values, phases = _display_values(display, pre_add=pre_add,
                                     length_per_100_steps=length_per_100_steps)
    rows = []
    # Associate actual CSV chunks with their source physical intervals.
    commands=[]
    for i,(value,phase) in enumerate(zip(values,phases)):
        chunks=build_rows([value],[phase],machine,unit)
        length=value*(length_per_100_steps/100)
        preview_length=max(0.0,length-(pre_add if i==len(values)-1 and phase==0 else 0))
        commands.append(dict(phase='liquid' if phase else 'gas', length=preview_length,
                             amount=sum(row[3] for row in chunks), unit=unit,
                             split=2000 if unit=='steps' else 89))
        rows.extend(chunks)
        if len(rows)>1_000_000:raise ValueError("export exceeds one million rows")
    return dict(rows=rows, commands=commands, total=sum(c['length'] for c in commands))


def display_rows(display, *, machine=MachineParameters(), unit='steps',
                 pre_add=730, length_per_100_steps=9.65):
    return display_plan(display, machine=machine, unit=unit, pre_add=pre_add,
                        length_per_100_steps=length_per_100_steps)['rows']
