import unittest
from types import SimpleNamespace as N
from fluixer.command_adapter import display_rows
from fluixer.export import MachineParameters

class CommandPolicyTests(unittest.TestCase):
    def rows(self,parts,pre_add=5):
        display=N(sequence=N(length_unit='mm',segments=[N(phase=p,length=n) for p,n in parts]))
        rows=display_rows(display,machine=MachineParameters(400,625,625),pre_add=pre_add,length_per_100_steps=10)
        return [(r[1],r[3]) for r in rows]

    def test_all_endpoint_combinations(self):
        cases=[
            ([('gas',10),('liquid',20),('gas',30)],[('l',200),('g',150)]),
            ([('gas',10),('liquid',20)],[('l',200),('g',150)]),
            ([('liquid',10),('gas',20)],[('l',100),('g',50)]),
            ([('liquid',10)],[('l',100),('g',50)]),
        ]
        for parts,expected in cases:
            with self.subTest(parts=parts):self.assertEqual(self.rows(parts),expected)

    def test_no_phantom_gas_without_extension(self):
        for extension in [0,1e-9]:
            self.assertEqual(self.rows([('liquid',10)],extension),[('l',100)])

    def test_empty_pattern_fills_entire_pipe(self):
        self.assertEqual(self.rows([('gas',10),('gas',20)]),[('g',350)])

    def test_invalid_lengths_rejected(self):
        for length in [-1,float('nan'),float('inf')]:
            with self.subTest(length=length),self.assertRaises(ValueError):self.rows([('liquid',length)])
        with self.assertRaises(ValueError):self.rows([('liquid',10)],-1)

if __name__=='__main__':unittest.main()
