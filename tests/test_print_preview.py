import unittest,math
from fluixer.print_preview import print_payload
class PrintPreviewTests(unittest.TestCase):
    def test_rotated_box_and_channel(self):
        c={'type':'interactive','radius':40,'diameter':4,'height':75,'wind':2,'points':[[0,0,0],[20,20,0],[40,40,0]],'target_length':math.sqrt(3200),'pins':[],'stiffness':.2,'avoid_collisions':True}
        result=print_payload({'cylinder':c,'inner':2})
        self.assertLess(math.prod(result['size']),44*44*4)
        self.assertEqual(len(result['vertices'])%18,0)
        self.assertTrue(all(math.isfinite(x) for x in result['vertices']))
        self.assertGreater(len(result['vertices']),36*6)
        changed=print_payload({'cylinder':c,'inner':3})
        self.assertEqual(result['size'],changed['size'])
        self.assertNotEqual(result['vertices'],changed['vertices'])
    def test_invalid_inner(self):
        for inner in [0,4,float('nan')]:
            with self.assertRaises(ValueError):print_payload({'cylinder':{'radius':40,'diameter':4,'height':75,'wind':2},'inner':inner})

    def test_open_ports_and_step_round_trip(self):
        from fluixer.print_preview import print_solid,print_settings,print_step_payload
        from fluixer.step_input import kernel,step_file
        kernel()
        from OCP.BRepClass3d import BRepClass3d_SolidClassifier
        from OCP.gp import gp_Pnt
        from OCP.TopAbs import TopAbs_OUT
        from OCP.STEPControl import STEPControl_Reader
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.BRepCheck import BRepCheck_Analyzer
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps
        for kind in ('s-curve','hilbert'):
            data={'cylinder':{'type':kind,'radius':40,'diameter':4,'height':75,'wind':2},'inner':2}
            shape,meta=print_solid(*print_settings(data))
            self.assertEqual(len(meta['ports']),2)
            for port in meta['ports']:
                for t in (.1,.5,.9,1.01):
                    p=[a+(b-a)*t for a,b in zip(port['start'],port['exit'])]
                    self.assertEqual(BRepClass3d_SolidClassifier(shape,gp_Pnt(*p),1e-6).State(),TopAbs_OUT)
            body=print_step_payload(data)
            with step_file() as path:
                path.write_bytes(body)
                reader=STEPControl_Reader()
                self.assertEqual(reader.ReadFile(str(path)),IFSelect_RetDone)
                reader.TransferRoots();restored=reader.OneShape()
            self.assertTrue(BRepCheck_Analyzer(restored).IsValid())
            before=GProp_GProps();after=GProp_GProps()
            BRepGProp.VolumeProperties_s(shape,before);BRepGProp.VolumeProperties_s(restored,after)
            self.assertAlmostEqual(before.Mass(),after.Mass(),delta=before.Mass()*1e-6)
