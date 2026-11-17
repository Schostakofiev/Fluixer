import unittest
from types import SimpleNamespace
from fluixer.command_adapter import display_rows
from fluixer.export import MachineParameters

class EmptyLiquidTests(unittest.TestCase):
    def display(self, parts):
        return SimpleNamespace(sequence=SimpleNamespace(length_unit='mm', segments=[SimpleNamespace(phase=p,length=n) for p,n in parts]))

    def test_gas_only_includes_whole_pipe_and_pre_add(self):
        display=self.display([('gas',100),('gas',50)])
        rows=display_rows(display,machine=MachineParameters(400,625,625),pre_add=10,length_per_100_steps=10)
        self.assertTrue(all(row[1]=='g' for row in rows))
        self.assertEqual(sum(row[3] for row in rows),1600)

    def test_gas_only_split_and_units(self):
        display=self.display([('gas',500)])
        for unit,total,limit in [('steps',5000,2000),('segments',75,89)]:
            rows=display_rows(display,machine=MachineParameters(400,625,625),unit=unit,pre_add=0,length_per_100_steps=10)
            self.assertEqual(sum(row[3] for row in rows),total)
            self.assertTrue(all(row[1]=='g' and 0<row[3]<=limit for row in rows))

    def test_pattern_tail_policy_unchanged(self):
        rows=display_rows(self.display([('gas',10),('liquid',20),('gas',30)]),machine=MachineParameters(400,625,625),pre_add=5,length_per_100_steps=10)
        self.assertEqual([(row[1],row[3]) for row in rows],[('l',200),('g',150)])

    def test_missing_pipe_rejected(self):
        with self.assertRaises(ValueError):display_rows(self.display([]))

if __name__=='__main__':unittest.main()
