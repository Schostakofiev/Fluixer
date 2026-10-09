"""Open, unbranched STEP centerlines. Coordinates and units remain in world mm.

G0 endpoint tolerance is 1e-5 mm. Curves are tessellated at 0.005 mm
deflection; simulation/export lengths refer to that polyline approximation.
"""
from functools import lru_cache
import math
from .step_input import kernel, step_file, MAX_BYTES
from .geometry import Line, TubePath

G0_TOLERANCE = 1e-5
DEFLECTION = .005

@lru_cache(maxsize=4)
def parse_tube_step(source):
    if not isinstance(source,str) or len(source.encode('utf-8'))>MAX_BYTES:
        raise ValueError('STEP files must not exceed 2 MB')
    if not source.lstrip().startswith('ISO-10303-21;') or 'END-ISO-10303-21;' not in source:
        raise ValueError('Not a valid STEP Part 21 file')
    kernel()
    try:
        return _read(source)
    except (ValueError,TypeError):
        raise
    except Exception as exc:
        raise ValueError('Could not read the STEP centerline. Check the curve geometry') from exc

def _read(source):
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.TopExp import TopExp, TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE
    from OCP.TopTools import TopTools_IndexedMapOfShape
    from OCP.TopoDS import TopoDS
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GCPnts import GCPnts_QuasiUniformDeflection
    from OCP.BRepCheck import BRepCheck_Analyzer
    reader=STEPControl_Reader()
    with step_file() as p:
        p.write_text(source,encoding='utf-8')
        if reader.ReadFile(str(p))!=IFSelect_RetDone:raise ValueError('Could not read the STEP file')
        reader.SetSystemLengthUnit(1.0)
        if reader.TransferRoots()<1:raise ValueError('No readable curves in the STEP file')
        shape=reader.OneShape()
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid():raise ValueError('Invalid STEP topology')
    if TopExp_Explorer(shape,TopAbs_FACE).More():raise ValueError('Export the tube centerline; surfaces and solids are not supported')
    edges=TopTools_IndexedMapOfShape();TopExp.MapShapes_s(shape,TopAbs_EDGE,edges)
    if not 1<=edges.Extent()<=2048:raise ValueError('STEP must contain 1–2048 centerline edges')
    nodes=[];adj=[];runs=[];total=0
    def node(p):
        matches=[i for i,q in enumerate(nodes) if math.dist(p,q)<=G0_TOLERANCE]
        if len(matches)>1:raise ValueError('Ambiguous endpoint connections. Repair the centerline')
        if matches:return matches[0]
        nodes.append(p);adj.append([]);return len(nodes)-1
    for i in range(1,edges.Extent()+1):
        curve=BRepAdaptor_Curve(TopoDS.Edge_s(edges.FindKey(i)))
        sample=GCPnts_QuasiUniformDeflection(curve,DEFLECTION)
        if not sample.IsDone() or sample.NbPoints()<2:raise ValueError('Centerline tessellation failed')
        total+=sample.NbPoints()
        if total>50000:raise ValueError('Centerline is too complex. Simplify it before importing')
        points=[(p.X(),p.Y(),p.Z()) for p in (sample.Value(j) for j in range(1,sample.NbPoints()+1))]
        if any(not math.isfinite(v) or abs(v)>1e6 for p in points for v in p):raise ValueError('Centerline coordinates are out of range')
        a,b=node(points[0]),node(points[-1])
        if a==b:raise ValueError('Centerline must be open; a closed curve was detected')
        idx=len(runs);runs.append((a,b,points));adj[a].append(idx);adj[b].append(idx)
    if any(len(e)>2 for e in adj):raise ValueError('Centerline branches detected. Use a single path')
    ends=[i for i,e in enumerate(adj) if len(e)==1]
    if not ends:raise ValueError('Centerline must be open; a closed path was detected')
    if len(ends)!=2:raise ValueError('Centerline is disconnected and not G0 continuous')
    current=ends[0];visited=set();ordered=[]
    while True:
        choices=[i for i in adj[current] if i not in visited]
        if not choices:break
        i=choices[0];visited.add(i);a,b,points=runs[i]
        points=list(points if current==a else reversed(points));current=b if current==a else a
        if ordered:points[0]=ordered[-1] # snap only within G0 tolerance
        ordered.extend(points if not ordered else points[1:])
    if len(visited)!=len(runs):raise ValueError('Separate curves or loops detected. Use one G0-continuous path')
    clean=[ordered[0]]
    for p in ordered[1:]:
        if math.dist(clean[-1],p)>1e-10:clean.append(p)
    if len(clean)<2:raise ValueError('Centerline has zero length')
    bounds=[[min(p[i] for p in clean) for i in range(3)],[max(p[i] for p in clean) for i in range(3)]]
    return dict(points=tuple(clean),bounds=bounds,length=sum(math.dist(a,b) for a,b in zip(clean,clean[1:])),
                edge_count=len(runs),g0_tolerance=G0_TOLERANCE,deflection=DEFLECTION)

def step_path(source,reverse=False):
    points=parse_tube_step(source)['points']
    if reverse:points=tuple(reversed(points))
    return TubePath(tuple(Line(a,b) for a,b in zip(points,points[1:])), 'mm')
