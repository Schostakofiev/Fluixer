"""The measured GH command policy, applied explicitly after simulation."""
from .gh_compat import prepare_export_branch
from .export import MachineParameters, build_rows


def display_rows(display, *, machine=MachineParameters(), unit='steps',
                 pre_add=730, length_per_100_steps=9.65):
    """Keep pre-add, panel precision, tail removal and reversal at export time.

    Only the measured alternating sequence with gas at both ends is accepted.
    Other topology needs an explicit policy rather than dropping liquid silently.
    """
    sequence=display.sequence
    segments=sequence.segments
    if sequence.length_unit!='mm':
        raise ValueError('GH command calibration requires lengths in mm')
    if display.pattern_id=='along-path':
        if not any(s.phase=='liquid' for s in segments):raise ValueError('No liquid intervals to export')
        lengths=[s.length for s in segments];phases=[int(s.phase=='liquid') for s in segments]
        # Preserve GH pre-add gas and reverse order, without dropping terminal liquid.
        if phases[0]==1:lengths.insert(0,0.0);phases.insert(0,0)
        if phases[-1]==1:lengths.append(0.0);phases.append(0)
        branch=prepare_export_branch((0,),lengths,phases[:-1],pre_add=pre_add,length_per_100_steps=length_per_100_steps)
        return build_rows(branch.values,branch.liquid_gas,machine,unit)
    if len(segments)<3 or len(segments)%2!=1 or any(
        s.phase!=('gas' if i%2==0 else 'liquid') for i,s in enumerate(segments)):
        raise ValueError('GH command policy requires alternating segments with gas at both ends')
    branch=prepare_export_branch((0,),[s.length for s in segments],
        [int(s.phase=='liquid') for s in segments[:-1]],pre_add=pre_add,
        length_per_100_steps=length_per_100_steps)
    return build_rows(branch.values,branch.liquid_gas,machine,unit)
