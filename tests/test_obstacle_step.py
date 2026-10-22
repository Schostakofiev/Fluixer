import unittest
from fluixer.obstacle_step import parse_obstacle_step
from fluixer.step_input import kernel,step_file

class ObstacleStepTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):kernel()
    def source(self,shape):
        from OCP.STEPControl import STEPControl_Writer,STEPControl_AsIs
        writer=STEPControl_Writer();writer.Transfer(shape,STEPControl_AsIs)
        with step_file() as path:
            writer.Write(str(path));return path.read_text()
    def test_closed_solid(self):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.gp import gp_Pnt
        mesh=parse_obstacle_step(self.source(BRepPrimAPI_MakeBox(gp_Pnt(10,20,30),20,30,40).Shape()))
        self.assertEqual(len(mesh['triangles']),12)
        self.assertEqual(mesh['unit'],'mm')
        pts=[p for t in mesh['triangles'] for p in t]
        self.assertEqual([min(p[k] for p in pts) for k in range(3)],[10,20,30])
        self.assertEqual([max(p[k] for p in pts) for k in range(3)],[30,50,70])
    def test_open_face_and_multiple_solids(self):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
        from OCP.gp import gp_Pln,gp_Pnt,gp_Dir
        face=BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(0,0,0),gp_Dir(0,0,1)),0,10,0,10).Face()
        with self.assertRaisesRegex(ValueError,'closed solid'):parse_obstacle_step(self.source(face))
        from OCP.TopoDS import TopoDS_Compound
        from OCP.BRep import BRep_Builder
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        compound=TopoDS_Compound();builder=BRep_Builder();builder.MakeCompound(compound)
        for x in [0,20]:builder.Add(compound,BRepPrimAPI_MakeBox(gp_Pnt(x,0,0),10,10,10).Shape())
        with self.assertRaisesRegex(ValueError,'one closed solid'):parse_obstacle_step(self.source(compound))
    def test_invalid_source(self):
        for value in [None,'bad','x'*2097153]:
            with self.assertRaises(ValueError):parse_obstacle_step(value)

if __name__=='__main__':unittest.main()
