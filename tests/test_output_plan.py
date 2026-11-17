import csv
import io
import unittest
from types import SimpleNamespace as N
from unittest.mock import patch
from fluixer.command_adapter import display_plan, display_rows
from fluixer.export import MachineParameters
from fluixer.pipeline import cylinder_settings
from fluixer.service import output_plan_payload, csv_payload

class OutputPlanTests(unittest.TestCase):
    def display(self,parts):
        return N(sequence=N(length_unit='mm',segments=[N(phase=p,length=n) for p,n in parts]))

    def test_interactive_supplied_length_is_not_recomputed(self):
        with patch('fluixer.interactive.interactive_path',side_effect=AssertionError('unnecessary path solve')):
            config=cylinder_settings(dict(radius=40,diameter=4,height=75,wind=16,type='interactive',points=[[0,0,0],[10,0,0],[20,0,0]],target_length=20))
        self.assertEqual(config.target_length,20)
        config=cylinder_settings(dict(radius=40,diameter=4,height=75,wind=16,type='interactive',points=[[0,0,0],[10,0,0],[20,0,0]]))
        self.assertAlmostEqual(config.target_length,20)

    def test_liquid_endpoint_includes_extension_gas(self):
        plan=display_plan(self.display([('liquid',10)]),pre_add=5,length_per_100_steps=10)
        self.assertEqual([(r[1],r[3]) for r in plan['rows']],[('l',100),('g',48)])
        self.assertEqual([(c['phase'],c['amount']) for c in plan['commands']],[('liquid',100),('gas',48)])
        self.assertEqual(plan['commands'][-1]['length'],0)
        self.assertAlmostEqual(plan['total'],10)

    def test_plan_and_csv_chunk_values_match(self):
        for parts in [[('liquid',401.25)],[('gas',10),('liquid',20),('gas',30)],[('gas',600)],[('liquid',10),('gas',20),('liquid',30)]]:
            for unit in ['steps','segments']:
                for pre_add in [0,5,730]:
                    plan=display_plan(self.display(parts),unit=unit,pre_add=pre_add,length_per_100_steps=10)
                    flattened=[]
                    for command in plan['commands']:
                        amount=command['amount']
                        while amount:
                            n=min(amount,command['split']);flattened.append(('l' if command['phase']=='liquid' else 'g',n));amount-=n
                    self.assertEqual(flattened,[(r[1],r[3]) for r in plan['rows']])
                    self.assertEqual(plan['rows'],display_rows(self.display(parts),unit=unit,pre_add=pre_add,length_per_100_steps=10))

    def test_half_even_rounding(self):
        plan=display_plan(self.display([('liquid',.25)]),pre_add=0,length_per_100_steps=10)
        self.assertEqual(plan['rows'][0][3],2)
        self.assertEqual(plan['commands'][0]['amount'],2)

    def test_export_and_endpoint_share_plan_timing_ignores_unit_and_preadd(self):
        data={'pattern':{'type':'empty'},'pre_add':0,'unit':'steps'}
        plan=output_plan_payload(data)
        body,_,_=csv_payload(data)
        rows=list(csv.reader(io.StringIO(body.decode('utf-8-sig'))))[1:]
        self.assertEqual(rows,[[str(v) for v in row] for row in plan['rows']])
        other=output_plan_payload(dict(data,pre_add=730,unit='segments'))
        self.assertEqual(plan['timing'],other['timing'])

if __name__=='__main__':unittest.main()
