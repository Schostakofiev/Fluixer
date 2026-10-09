"""Explicit compatibility for the measured GH numeric tail, after geometry solve.

Matches #72 -> #231/#229 -> #75 -> #73 -> #114 -> #115 -> #126/#127.
Formatting is an explicit measured profile, not a universal GH default.
"""
from dataclasses import dataclass
from .geometry import finite
from .length_conversion import ExecutionBranch, convert_length_branch


@dataclass(frozen=True)
class GHNumericProfile:
    length_panel_decimals: int = 6
    steps_panel_decimals: int = 6

    def __post_init__(self):
        for digits in (self.length_panel_decimals,self.steps_panel_decimals):
            if type(digits) is not int or not 0 <= digits <= 15:
                raise ValueError('panel precision must be an integer from 0 to 15')


def prepare_export_branch(path, subcurve_lengths, phases, *, pre_add,
                          length_per_100_steps, profile=GHNumericProfile()):
    """One solved GH branch. Final uncommanded tail is intentionally removed.

    phases already comes from #170 (one fewer item than #72). No claim is made
    that curve-domain deltas equal subcurve lengths. No automatic flattening.
    """
    lengths = [finite(x,'subcurve length') for x in subcurve_lengths]
    phases = tuple(phases)
    pre_add = finite(pre_add,'pre-add')
    if not lengths or len(lengths) != len(phases)+1:
        raise ValueError('GH branch requires exactly one extra trailing subcurve')
    if pre_add < 0 or any(x < 0 for x in lengths):
        raise ValueError('lengths and pre-add must be nonnegative')
    lengths[0] += pre_add
    lengths = [float(format(x,f'.{profile.length_panel_decimals}f')) for x in lengths[:-1]]
    branch = convert_length_branch(path,lengths,phases,length_per_100_steps)
    values = tuple(float(format(x,f'.{profile.steps_panel_decimals}f')) for x in branch.values)
    return ExecutionBranch(branch.path,values,branch.liquid_gas)
