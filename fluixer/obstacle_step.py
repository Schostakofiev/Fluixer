"""Closed STEP solid to a bounded collision mesh, in millimetres."""
from functools import lru_cache
import math
from .step_input import kernel, step_file, MAX_BYTES

@lru_cache(maxsize=3)
def parse_obstacle_step(source):
    if not isinstance(source,str) or len(source.encode('utf-8'))>MAX_BYTES:
        raise ValueError('STEP files must not exceed 2 MB')
    if not source.lstrip().startswith('ISO-10303-21;') or 'END-ISO-10303-21;' not in source:
        raise ValueError('Not a valid STEP Part 21 file')
    kernel()
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID,TopAbs_FACE,TopAbs_REVERSED
    from OCP.TopoDS import TopoDS
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location
    reader=STEPControl_Reader()
    with step_file() as p:
        p.write_text(source,encoding='utf-8')
        if reader.ReadFile(str(p))!=IFSelect_RetDone:raise ValueError('Could not read STEP')
        reader.SetSystemLengthUnit(1.0)
        if reader.TransferRoots()<1:raise ValueError('STEP contains no geometry')
        shape=reader.OneShape()
    solids=TopExp_Explorer(shape,TopAbs_SOLID)
    if not solids.More():raise ValueError('Collision obstacles require a closed solid, not curves or open surfaces')
    solid=solids.Current();solids.Next()
    if solids.More():raise ValueError('Import one closed solid per obstacle')
    if not BRepCheck_Analyzer(solid).IsValid():raise ValueError('STEP solid has invalid topology')
    # Reject mixed solids and loose faces rather than silently dropping geometry.
    def face_count(s):
        ex=TopExp_Explorer(s,TopAbs_FACE);n=0
        while ex.More():n+=1;ex.Next()
        return n
    if face_count(shape)!=face_count(solid):raise ValueError('Remove loose surfaces from the STEP obstacle')
    BRepMesh_IncrementalMesh(solid,.05,False,.18,True)
    triangles=[];faces=TopExp_Explorer(solid,TopAbs_FACE)
    while faces.More():
        face=TopoDS.Face_s(faces.Current());loc=TopLoc_Location()
        mesh=BRep_Tool.Triangulation_s(face,loc)
        if not mesh:raise ValueError('Could not mesh the obstacle')
        for i in range(1,mesh.NbTriangles()+1):
            ids=list(mesh.Triangle(i).Get())
            if face.Orientation()==TopAbs_REVERSED:ids.reverse()
            pts=[list(mesh.Node(j).Transformed(loc.Transformation()).Coord()) for j in ids]
            if any(not math.isfinite(v) or abs(v)>10000 for pt in pts for v in pt):raise ValueError('Obstacle coordinates exceed 10000 mm')
            triangles.append(pts)
            if len(triangles)>12000:raise ValueError('Obstacle mesh exceeds 12000 triangles; simplify the solid')
        faces.Next()
    if not triangles:raise ValueError('Obstacle has no faces')
    return {'triangles':triangles,'unit':'mm','tolerance':.05}
