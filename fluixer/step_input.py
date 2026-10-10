"""STEP planar face import through OpenCascade; normalized contour output."""
from functools import lru_cache
from pathlib import Path
import sys,tempfile,math,uuid
from contextlib import contextmanager

@contextmanager
def step_file():
    p=Path(tempfile.gettempdir())/("fluixer-step-"+uuid.uuid4().hex+".stp")
    try:yield p
    finally:p.unlink(missing_ok=True)

MAX_BYTES=2*1024*1024

def kernel():
    vendor=Path(__file__).resolve().parents[1]/'vendor'
    if vendor.is_dir() and str(vendor) not in sys.path:sys.path.insert(0,str(vendor))
    try:
        import OCP
    except (ImportError,OSError) as e:raise ValueError('STEP geometry library is missing. Run Install-Step.ps1 from the installation package') from e

@lru_cache(maxsize=4)
def parse_step(source):
    if not isinstance(source,str) or len(source.encode('utf-8'))>MAX_BYTES:raise ValueError('STEP files must not exceed 2 MB')
    if not source.lstrip().startswith('ISO-10303-21;') or 'END-ISO-10303-21;' not in source:raise ValueError('Not a valid STEP Part 21 file')
    kernel()
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE,TopAbs_WIRE,TopAbs_SOLID,TopAbs_REVERSED
    from OCP.TopoDS import TopoDS
    from OCP.BRepAdaptor import BRepAdaptor_Surface,BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Plane
    from OCP.BRepTools import BRepTools_WireExplorer
    from OCP.GCPnts import GCPnts_QuasiUniformDeflection
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.Interface import Interface_Static
    Interface_Static.SetCVal_s('xstep.cascade.unit','MM')
    reader=STEPControl_Reader()
    with step_file() as p:
        p.write_text(source,encoding='utf-8')
        if reader.ReadFile(str(p))!=IFSelect_RetDone:raise ValueError('Could not read the STEP file')
        reader.SetSystemLengthUnit(1.0)
        if reader.TransferRoots()<1:raise ValueError('No readable geometry in the STEP file')
        shape=reader.OneShape()
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid():raise ValueError('Invalid STEP topology')
    if TopExp_Explorer(shape,TopAbs_SOLID).More():raise ValueError('Export planar regions; 3D solids are not supported')
    faces=TopExp_Explorer(shape,TopAbs_FACE);groups=[];origin=None;normal=None;axis_u=None;axis_v=None;total=0
    def xyz(p):return (p.X(),p.Y(),p.Z())
    def dot(a,b):return sum(x*y for x,y in zip(a,b))
    def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
    while faces.More():
        face=TopoDS.Face_s(faces.Current());surface=BRepAdaptor_Surface(face)
        if surface.GetType()!=GeomAbs_Plane:raise ValueError('Only planar regions are supported. Flatten surfaces first')
        plane=surface.Plane();n=xyz(plane.Axis().Direction());o=xyz(plane.Location())
        if origin is None:
            origin=o;idx=max(range(3),key=lambda i:abs(n[i]));normal=tuple(v*(1 if n[idx]>=0 else -1) for v in n)
            base=(1,0,0) if abs(normal[0])<.9 else (0,1,0)
            u=tuple(a-dot(base,normal)*b for a,b in zip(base,normal));length=math.sqrt(dot(u,u));axis_u=tuple(v/length for v in u);axis_v=cross(normal,axis_u)
            # For XZ faces use Z upward instead of -Z.
            if abs(normal[1])>.999999:axis_v=tuple(-v for v in axis_v)
        if abs(abs(dot(n,normal))-1)>1e-8 or abs(dot(tuple(a-b for a,b in zip(o,origin)),normal))>1e-5:raise ValueError('All regions must be coplanar')
        rings=[];wires=TopExp_Explorer(face,TopAbs_WIRE)
        while wires.More():
            wire=TopoDS.Wire_s(wires.Current());edges=BRepTools_WireExplorer(wire,face);ring=[]
            while edges.More():
                edge=edges.Current();curve=BRepAdaptor_Curve(edge);sample=GCPnts_QuasiUniformDeflection(curve,0.01)
                if not sample.IsDone():raise ValueError('Could not tessellate the STEP boundary')
                points=[xyz(sample.Value(i)) for i in range(1,sample.NbPoints()+1)]
                if edge.Orientation()==TopAbs_REVERSED:points.reverse()
                if ring and math.dist(ring[-1],points[0])>1e-4:raise ValueError('STEP boundary is discontinuous')
                ring.extend(points if not ring else points[1:]);total+=len(points)
                if total>20000:raise ValueError('STEP boundary is too complex. Simplify it first')
                edges.Next()
            if len(ring)<4 or math.dist(ring[0],ring[-1])>1e-4:raise ValueError('STEP region boundary is not closed')
            rings.append([ (dot(tuple(a-b for a,b in zip(p,origin)),axis_u),dot(tuple(a-b for a,b in zip(p,origin)),axis_v)) for p in ring[:-1]])
            wires.Next()
        groups.append(('evenodd',rings));faces.Next()
        if len(groups)>128:raise ValueError('Too many STEP regions')
    if not groups:raise ValueError('No faces in STEP. Create planar surfaces from closed curves before exporting')
    points=[p for _,rs in groups for r in rs for p in r];xmin=min(p[0] for p in points);ymin=min(p[1] for p in points);w=max(p[0] for p in points)-xmin;h=max(p[1] for p in points)-ymin
    if min(w,h)<=1e-6:raise ValueError('STEP region has zero size')
    normalized=tuple((rule,tuple(tuple(((x-xmin)/w,(y-ymin)/h) for x,y in ring) for ring in rings)) for rule,rings in groups)
    return {'groups':normalized,'view_box':(0,0,w,h),'point_count':len(points),'ring_count':sum(len(rs) for _,rs in groups),'conversion_notes':['Converted planar regions; boundary tessellation tolerance: 0.01 mm'],'unit':'mm'}

def step_contours(source,width,height,x,z,levels):
    from .svg_input import groups_contours
    return groups_contours(parse_step(source)['groups'],width,height,x,z,levels)
