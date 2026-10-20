import math
import unittest
from fluixer.pipeline import cylinder_settings, cylinder_config, tube_path
from fluixer.webapp import preview, csv_payload
from fluixer.interactive import validate_points

class InteractiveTests(unittest.TestCase):
    def tube(self, points):
        return cylinder_settings(dict(type='interactive',radius=40,height=75,diameter=4,wind=16,points=points))
    def test_straight_and_roundtrip(self):
        c=self.tube([[i*2.5,0,37.5] for i in range(33)])
        self.assertAlmostEqual(tube_path(c).length,80)
        self.assertEqual(cylinder_settings(cylinder_config(c)),c)
    def test_spatial_curve_preview_export(self):
        c=self.tube([[i*2.5,8*math.sin(i/32*math.pi),37.5+12*math.sin(i/32*math.pi)] for i in range(33)])
        path=tube_path(c)
        self.assertGreater(path.length,80)
        for a,b in zip(path.pieces,path.pieces[1:]):
            for x,y in zip(a.point_at(1),b.point_at(0)):self.assertAlmostEqual(x,y)
            for x,y in zip(a.derivative(1),b.derivative(0)):self.assertAlmostEqual(x,y)
        data=preview(cylinder=c)
        self.assertGreater(len(data['segments']),0)
        self.assertEqual(data['cylinder']['points'],c.points)
        for unit in ('steps','segments'):
            body,name,count=csv_payload(dict(cylinder=cylinder_config(c),unit=unit,pre_add=0))
            self.assertGreater(count,0)
            self.assertIn(b'move',body)
    def test_pins_and_required_collisions(self):
        data=dict(type='interactive',radius=40,height=75,diameter=4,wind=16,points=[[i*2.5,0,0] for i in range(33)],pins=[0,16,32])
        c=cylinder_settings(data)
        self.assertEqual(c.pins,(0,16,32))
        self.assertEqual(c.stiffness,.2)
        self.assertEqual(cylinder_settings(dict(data,stiffness=.8)).stiffness,.8)
        for stiffness in (-.1,1.1,True,float("nan")):
            with self.assertRaises(ValueError):cylinder_settings(dict(data,stiffness=stiffness))
        self.assertEqual(cylinder_settings(cylinder_config(c)),c)
        for pins in ([33],[True],[1,1],[-1]):
            with self.assertRaises(ValueError):cylinder_settings(dict(data,pins=pins))
        with self.assertRaises(ValueError):cylinder_settings(dict(data,avoid_collisions=False))

    def test_reject_invalid(self):
        for points in ([],[[0,0,0]]*3,[[0,0,0],[1,0,0],[0,0,0]],[[0,0,0],[1,float('nan'),0],[2,0,0]]):
            with self.assertRaises(ValueError):validate_points(points)

    def test_constraints(self):
        from fluixer.interactive import interactive_path,check_constraints
        line=interactive_path([[i*2.5,0,0] for i in range(33)])
        check_constraints(line,4,80)
        with self.assertRaises(ValueError):check_constraints(line,4,79)
        overpass=[]
        for i in range(65):
            t=-1.5*math.pi+i/64*2*math.pi
            overpass.append([30*math.sin(t),10*t,20*math.sin(2*t)])
        check_constraints(interactive_path(overpass),4)
        crossing=[[p[0],0,p[2]] for p in overpass]
        # Use slightly different endpoints to preserve the open-curve invariant.
        crossing[-1][0]+=.1
        with self.assertRaises(ValueError):check_constraints(interactive_path(crossing),4)
        check_constraints(interactive_path(crossing),4,avoid_collisions=False)
        tiny=interactive_path([[math.cos(i/32*math.pi),0,math.sin(i/32*math.pi)] for i in range(33)])
        check_constraints(tiny,4)  # Local curvature is no longer a collision veto.

if __name__=='__main__':unittest.main()
