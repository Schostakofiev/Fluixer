"""Replay the solved numeric tail from one diagnostic snapshot without Rhino."""
from .export import MachineParameters, build_rows
from .gh_compat import prepare_export_branch


def replay(snapshot, unit=None):
    if snapshot.get('schema') != 'fluixel-gh-snapshot-v1':
        raise ValueError('unsupported snapshot schema')
    stages = {s['index']:s for s in snapshot['stages']}
    controls = {s['index']:s for s in snapshot['controls']}

    def one_branch(item):
        if item.get('errors'):
            raise ValueError('snapshot contains component errors: '+str(item['index']))
        branches = item['outputs'][0]['branches']
        if len(branches) != 1:
            raise ValueError('this replay supports a single branch only; refusing to flatten')
        return branches[0]

    def scalar(item):
        values = one_branch(item)['items']
        if len(values) != 1:
            raise ValueError('expected one scalar value')
        return float(values[0])

    lengths = one_branch(stages[72])
    phases = one_branch(stages[170])
    calibration = scalar(controls[243])
    if calibration/100 != scalar(stages[222]):
        raise ValueError('snapshot calibration wiring differs from the verified GH profile')
    branch = prepare_export_branch(phases['path'], lengths['items'], phases['items'],
        pre_add=scalar(controls[213]),length_per_100_steps=calibration)
    expected = snapshot['export_input']
    if branch.values != tuple(float(x) for x in expected['values']):
        raise ValueError('numeric replay differs from captured exporter input')
    if branch.liquid_gas != tuple(float(x) for x in expected['liquid_gas']):
        raise ValueError('numeric replay differs from captured phase sequence')
    machine = MachineParameters(expected['speed'],expected['k_gas'],expected['k_liquid'])
    return build_rows(branch.values,branch.liquid_gas,machine,expected['unit'] if unit is None else unit)
