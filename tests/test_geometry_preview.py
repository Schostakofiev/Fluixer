import unittest
from unittest.mock import patch
from fluixer.webapp import display_payload, geometry_preview

class GeometryPreviewTests(unittest.TestCase):
    def test_no_liquid_computation(self):
        geometry_preview.cache_clear()
        with patch('fluixer.webapp.simulate_along_path', side_effect=AssertionError('segmentation called')), patch('fluixer.webapp.pattern_key', side_effect=AssertionError('pattern processed')):
            for kind in ['cylinder','s-curve','hilbert','interactive']:
                tube=dict(type=kind,radius=40,diameter=4,height=75,wind=2)
                if kind=='interactive':tube.update(points=[[0,0,0],[40,0,0],[80,0,0]],target_length=80,pins=[],stiffness=.2,avoid_collisions=True)
                data=display_payload(dict(cylinder=tube,geometry_only=True,pattern={'ignored':True}))
                self.assertTrue(data['geometry_only'])
                self.assertGreater(data['path_length'],0)
                self.assertEqual(data['plane'],[])
                self.assertTrue(all(s['phase']=='gas' for s in data['segments']))
    def test_normal_preview_unchanged(self):
        data=display_payload(dict(cylinder=dict(radius=40,diameter=4,height=75,wind=16)))
        self.assertFalse(data.get('geometry_only',False))
        self.assertTrue(any(s['phase']=='liquid' for s in data['segments']))
    def test_mode_must_be_boolean(self):
        with self.assertRaises(ValueError):display_payload(dict(geometry_only='yes'))
