import math,unittest
from dataclasses import replace
from unittest.mock import patch
from fluixer.pipeline import cylinder_settings,cylinder_config,pipe_path,reverse_path,path_bounds

class ReversePathTests(unittest.TestCase):
    def test_all_curve_types(self):
        for kind in ('cylinder','s-curve','hilbert','interactive','custom-step'):
            config={'type':kind,'radius':40,'diameter':4,'height':75,'wind':2,'center':[3,4,5]}
            if kind=='interactive':config.update(points=[[0,0,0],[40,0,0],[80,0,0]],target_length=80,pins=[0],stiffness=.2,avoid_collisions=True)
            if kind=='custom-step':config.update(source='test centerline')
            with patch('fluixer.pipe_step.parse_pipe_step',return_value={'points':((0,0,0),(20,0,0),(20,30,0))}):
                c=cylinder_settings(config);forward=pipe_path(c);backward=pipe_path(replace(c,reverse=True))
            self.assertAlmostEqual(forward.length,backward.length,places=6,msg=kind)
            for i in range(21):
                a=forward.point_at_distance(forward.length*i/20)
                b=backward.point_at_distance(backward.length*(1-i/20))
                self.assertLess(math.dist(a,b),.0001,kind)
            for a,b in zip(path_bounds(forward),path_bounds(backward)):self.assertLess(math.dist(a,b),.0001)
            twice=reverse_path(reverse_path(forward))
            self.assertLess(math.dist(forward.point_at_distance(forward.length*.3),twice.point_at_distance(twice.length*.3)),.0001)
            self.assertTrue(cylinder_config(cylinder_settings({**config,'reverse':True}))['reverse'])
    def test_reject_nonboolean(self):
        with self.assertRaises(ValueError):cylinder_settings({'radius':40,'diameter':4,'height':75,'wind':2,'reverse':'yes'})
