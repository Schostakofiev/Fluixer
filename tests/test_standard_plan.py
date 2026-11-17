import unittest
from fluixer.standard_leveling import standard_plan_payload, standard_rows

class StandardPlanTests(unittest.TestCase):
    def test_structured_commands_match_standard_rows(self):
        for kind in ['cylinder','s-curve']:
            for pre_add in [0,730]:
                data=dict(cylinder=dict(type=kind,radius=40,diameter=4,height=75,wind=4),pre_add=pre_add)
                plan=standard_plan_payload(data)
                rows,count=standard_rows(data)
                self.assertEqual(plan['count'],count)
                self.assertNotIn('source',plan)
                self.assertEqual([[c['motor'],c['direction'],c['count'],c['speed'],c['unit']] for c in plan['commands']],[r[1:6] for r in rows])
                self.assertTrue(all(c['count']==100 for c in plan['commands'] if c['motor']=='l'))

if __name__=='__main__':unittest.main()
