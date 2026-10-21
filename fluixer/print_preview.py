"""CAD solid preview: optimized oriented enclosure minus the inner channel."""
from functools import lru_cache
import math
from .step_input import kernel
from .pipeline import pipe_path, cylinder_settings
from .geometry import Line, UpwardSemicircle, CircularArc
from .cubic import CubicSpan


def print_settings(data):
    if not isinstance(data,dict) or set(data)!={'cylinder','inner'}:
        raise ValueError('Expected pipe parameters and inner diameter')
    c=cylinder_settings(data['cylinder'])
    inner=float(data['inner'])
    if not math.isfinite(inner) or not 0<inner<c.diameter:
        raise ValueError('Inner diameter must be positive and below outer diameter')
    return c,inner


def print_payload(data):
    c,inner=print_settings(data)
    try:
        return print_mesh(c,inner)
    except (ValueError,TypeError):
        raise
    except Exception as exc:
        raise ValueError("Could not generate the print solid. Check tight bends and overlapping channels") from exc


@lru_cache(maxsize=3)
def print_solid(c,inner):
    kernel()
    from OCP.gp import gp_Pnt,gp_Dir,gp_Ax2,gp_Circ
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge,BRepBuilderAPI_MakeWire,BRepBuilderAPI_RoundCorner
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell
    from OCP.GC import GC_MakeArcOfCircle
    from OCP.Geom import Geom_BezierCurve
    from OCP.TColgp import TColgp_Array1OfPnt
    from OCP.Bnd import Bnd_OBB
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE,TopAbs_REVERSED
    from OCP.TopoDS import TopoDS
    from OCP.TopLoc import TopLoc_Location
    from OCP.BRep import BRep_Tool
    path=pipe_path(c)
    wire=BRepBuilderAPI_MakeWire()
    from OCP.GeomConvert import GeomConvert_CompCurveToBSplineCurve
    joined=GeomConvert_CompCurveToBSplineCurve() if all(isinstance(p,CubicSpan) for p in path.pieces) else None
    for piece in path.pieces:
        if isinstance(piece,Line):
            edge=BRepBuilderAPI_MakeEdge(gp_Pnt(*piece.start),gp_Pnt(*piece.end))
        elif isinstance(piece,(UpwardSemicircle,CircularArc)):
            edge=BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(*[gp_Pnt(*piece.point_at(t)) for t in (0,.5,1)]).Value())
        elif isinstance(piece,CubicSpan):
            poles=TColgp_Array1OfPnt(1,4)
            coords=piece.coefficients
            for j,t in enumerate([0,1,2,3],1):
                poles.SetValue(j,gp_Pnt(*[(a,a+b/3,a+2*b/3+cc/3,a+b+cc+d)[t] for a,b,cc,d in coords]))
            curve=Geom_BezierCurve(poles)
            if joined is not None and not joined.Add(curve,1e-6,True):raise ValueError("Could not join print centerline")
            edge=BRepBuilderAPI_MakeEdge(curve)
        else:raise ValueError('Unsupported print path geometry')
        wire.Add(edge.Edge())
    spine=BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(joined.BSplineCurve()).Edge()).Wire() if joined is not None else wire.Wire()
    box=Bnd_OBB()
    samples=[]
    for piece in path.pieces:
        count=1 if isinstance(piece,Line) else 36 if isinstance(piece,(UpwardSemicircle,CircularArc)) else 8
        samples.extend(piece.point_at(i/count) for i in range(count+1))
    points=TColgp_Array1OfPnt(1,len(samples))
    for i,point in enumerate(samples,1):points.SetValue(i,gp_Pnt(*point))
    box.ReBuild(points,None,True)
    # Compare CAD, PCA and world frames; refine orientations by volume.
    # PCA also handles collinear paths for which the CAD OBB can remain axis-aligned.
    import numpy as np
    cloud=np.asarray(samples,dtype=float)
    _,pca=np.linalg.eigh(np.cov(cloud.T))
    candidates=[np.eye(3),pca.T,np.asarray([box.XDirection().Coord(),box.YDirection().Coord(),box.ZDirection().Coord()])]
    def extent(frame):
        projected=cloud@frame.T
        low=projected.min(axis=0);high=projected.max(axis=0)
        return float(np.prod(high-low+c.diameter)),low,high
    best=None
    for frame in candidates:
        if np.linalg.det(frame)<0:frame[2]*=-1
        score,_,_=extent(frame)
        for degrees in (15,5,1,.25):
            for iteration in range(12):
                improved=False
                for i,j in ((0,1),(0,2),(1,2)):
                    for sign in (-1,1):
                        angle=math.radians(degrees*sign);trial=frame.copy()
                        trial[i]=math.cos(angle)*frame[i]+math.sin(angle)*frame[j]
                        trial[j]=-math.sin(angle)*frame[i]+math.cos(angle)*frame[j]
                        value,_,_=extent(trial)
                        if value<score*(1-1e-9):frame,score,improved=trial,value,True
                if not improved:break
        if best is None or score<best[0]:best=(score,frame)
    axes=best[1].tolist()
    _,low,high=extent(best[1])
    half=((high-low+c.diameter)/2).tolist()
    center=(((low+high)/2)@best[1]).tolist()
    corner=[center[k]-sum(half[j]*axes[j][k] for j in range(3)) for k in range(3)]
    block=BRepPrimAPI_MakeBox(gp_Ax2(gp_Pnt(*corner),gp_Dir(*axes[2]),gp_Dir(*axes[0])),*[2*v for v in half]).Shape()
    start=path.pieces[0].point_at(0)
    near=path.pieces[0].point_at(.0001)
    tangent=[b-a for a,b in zip(start,near)]
    profile=BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(*start),gp_Dir(*tangent)),inner/2)).Edge()).Wire()
    sweep=BRepOffsetAPI_MakePipeShell(spine)
    sweep.SetTransitionMode(BRepBuilderAPI_RoundCorner)
    sweep.Add(profile,False,True)
    sweep.Build()
    if not sweep.IsDone() or not sweep.MakeSolid():raise ValueError('Could not form the internal channel; simplify tight bends')
    cut=BRepAlgoAPI_Cut(block,sweep.Shape())
    cut.Build()
    if not cut.IsDone() or not BRepCheck_Analyzer(cut.Shape()).IsValid():
        raise ValueError('Could not form a valid print preview; check bends and overlaps')
    shape=cut.Shape()
    ports=[]
    if c.type in ('s-curve','hilbert'):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
        for piece,end in ((path.pieces[0],0),(path.pieces[-1],1)):
            point=piece.point_at(end)
            if isinstance(piece,Line):
                derivative=[b-a for a,b in zip(piece.start,piece.end)]
            elif isinstance(piece,UpwardSemicircle):
                derivative=[piece.side*math.cos(math.pi*end),0,math.sin(math.pi*end)]
            elif isinstance(piece,CircularArc):
                angle=piece.start_angle+piece.sweep*end
                derivative=[-math.sin(angle)*piece.sweep,0,math.cos(angle)*piece.sweep]
            else:
                derivative=[b+2*cc*end+3*d*end*end for a,b,cc,d in piece.coefficients]
            direction=[v*(1 if end else -1) for v in derivative]
            norm=math.hypot(*direction);direction=[v/norm for v in direction]
            local=[sum((point[k]-center[k])*axes[j][k] for k in range(3)) for j in range(3)]
            ray=[sum(direction[k]*axes[j][k] for k in range(3)) for j in range(3)]
            travel=min((math.copysign(half[j],ray[j])-local[j])/ray[j] for j in range(3) if abs(ray[j])>1e-9)
            overlap=min(inner*.1,piece.length*.01)
            origin=[point[k]-direction[k]*overlap for k in range(3)]
            bore=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*origin),gp_Dir(*direction)),inner/2,travel+overlap+inner).Shape()
            cut=BRepAlgoAPI_Cut(shape,bore);cut.Build()
            if not cut.IsDone() or not BRepCheck_Analyzer(cut.Shape()).IsValid():raise ValueError('Could not open the print channel endpoints')
            shape=cut.Shape()
            ports.append({'start':list(point),'exit':[point[k]+travel*direction[k] for k in range(3)],'direction':direction})
    return shape,{'center':center,'axes':axes,'size':[2*v for v in half],'ports':ports}


@lru_cache(maxsize=3)
def print_mesh(c,inner):
    shape,metadata=print_solid(c,inner)
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE,TopAbs_REVERSED
    from OCP.TopoDS import TopoDS
    from OCP.TopLoc import TopLoc_Location
    from OCP.BRep import BRep_Tool
    BRepMesh_IncrementalMesh(shape,.12,False,.25,True)
    vertices=[]
    faces=TopExp_Explorer(shape,TopAbs_FACE)
    while faces.More():
        face=TopoDS.Face_s(faces.Current());loc=TopLoc_Location()
        mesh=BRep_Tool.Triangulation_s(face,loc)
        if mesh:
            for i in range(1,mesh.NbTriangles()+1):
                ids=list(mesh.Triangle(i).Get())
                if face.Orientation()==TopAbs_REVERSED:ids.reverse()
                pts=[list(mesh.Node(j).Transformed(loc.Transformation()).Coord()) for j in ids]
                u=[pts[1][k]-pts[0][k] for k in range(3)];v=[pts[2][k]-pts[0][k] for k in range(3)]
                n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
                length=math.hypot(*n)
                if length>1e-12:
                    n=[x/length for x in n]
                    for pt in pts:vertices.extend(pt+n)
        faces.Next()
    return {'vertices':vertices,**metadata}


def print_step_payload(data):
    c,inner=print_settings(data)
    try:
        shape,_=print_solid(c,inner)
        from OCP.STEPControl import STEPControl_Writer,STEPControl_AsIs
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.Interface import Interface_Static
        from .step_input import step_file
        Interface_Static.SetCVal_s('write.step.unit','MM')
        writer=STEPControl_Writer()
        if writer.Transfer(shape,STEPControl_AsIs)!=IFSelect_RetDone:raise ValueError('STEP transfer failed')
        with step_file() as path:
            if writer.Write(str(path))!=IFSelect_RetDone:raise ValueError('STEP export failed')
            return path.read_bytes()
    except (ValueError,TypeError):raise
    except Exception as exc:raise ValueError('Could not export the print solid as STEP') from exc
