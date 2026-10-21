import unittest
from fluixer.standard_leveling import standard_rows, row_centers
from fluixer.pipeline import cylinder_settings

class StandardRoundingTests(unittest.TestCase):
    def reconstructed(self, payload):
        rows,count=standard_rows(payload)
        commands=[]
        for row in rows:
            self.assertIsInstance(row[3],int)
            self.assertGreater(row[3],0)
            self.assertLessEqual(row[3],2000)
            if commands and commands[-1][0]==row[1]:commands[-1][1]+=row[3]
            else:commands.append([row[1],row[3]])
        self.assertEqual(sum(m=='l' for m,_ in commands),count)
        self.assertTrue(all(steps==100 for m,steps in commands if m=='l'))
        step_length=payload.get('length_per_100_steps',9.65)/100
        gas_step=step_length*625/int(payload.get('k_gas',606))
        position=-payload.get('pre_add',730)
        centers=[]
        for motor,steps in reversed(commands):
            length=steps*(gas_step if motor=='g' else step_length)
            if motor=='l':centers.append(position+length/2)
            position+=length
        return centers,gas_step,rows

    def test_centers_never_accumulate_more_than_half_a_gas_step(self):
        from fluixer.compensation import curve_settings
        for kind in ['cylinder','s-curve']:
            for wind in [4,16,32]:
                for k,pre_add,distance in [(606,730,9.65),(625,0,9.65),(700.9,123.45,12.3)]:
                    with self.subTest(kind=kind,wind=wind,k=k):
                        pipe={'type':kind,'radius':40,'height':75,'diameter':4,'wind':wind}
                        payload={'cylinder':pipe,'k_gas':k,'pre_add':pre_add,'length_per_100_steps':distance}
                        actual,step,_=self.reconstructed(payload)
                        ideal=row_centers(cylinder_settings(pipe))
                        self.assertEqual(len(actual),len(ideal))
                        self.assertLessEqual(max(abs(a-b) for a,b in zip(actual,ideal)),step/2+1e-8)

    def test_compensated_centers_keep_same_error_bound(self):
        from fluixer.compensation import curve_settings
        curve={'amplitude':5,'x':[0,1/3,2/3,1],'y':[-.3,.8,-.4,.2]}
        for kind in ['cylinder','s-curve']:
            pipe={'type':kind,'radius':40,'height':75,'diameter':4,'wind':16}
            actual,step,_=self.reconstructed({'cylinder':pipe,'compensation':curve})
            ideal=row_centers(cylinder_settings(pipe),curve_settings(curve))
            self.assertLessEqual(max(abs(a-b) for a,b in zip(actual,ideal)),step/2+1e-8)

    def test_total_gas_budget_is_rounded_once(self):
        pipe={'type':'s-curve','radius':40,'height':75,'diameter':4,'wind':16}
        centers=row_centers(cylinder_settings(pipe))
        _,_,rows=self.reconstructed({'cylinder':pipe})
        expected=round(((centers[-1]+730)/.0965-100*(len(centers)-.5))*606/625)
        self.assertEqual(sum(row[3] for row in rows if row[1]=='g'),expected)

    def test_zero_gas_factor_rejected(self):
        with self.assertRaises(ValueError):standard_rows({'k_gas':0})

if __name__=='__main__':unittest.main()
