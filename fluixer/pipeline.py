"""Along-path simulation for generated and imported tube paths.

No machine parameters or export units enter the simulation result.
"""
from dataclasses import dataclass, replace
from .cubic import CubicPath, cylinder_spiral

from .geometry import finite, s_curve, hilbert_curve, TubePath

from .segments import PhysicalSequence


@dataclass(frozen=True)
class CylinderSettings:
    radius: float = 40
    diameter: float = 4
    height: float = 75
    wind: int = 16
    samples_per_turn: int = 150
    period: int = 1
    type: str = "cylinder"
    mapping: str = "projection"
    placement: tuple | None = None
    source: str | None = None
    reverse: bool = False
    center: tuple | None = None
    initial_placement: tuple | None = None


def cylinder_settings(value=None):
    if value is None:return CylinderSettings()
    if not isinstance(value,dict) or not {'radius','diameter','height','wind'}<=set(value) or set(value)-{'radius','diameter','height','wind','type','mapping','placement','source','reverse','center','initial_placement'}:raise ValueError('Incomplete tube parameters')
    radius,diameter,height,wind=(finite(value[n],n) for n in ('radius','diameter','height','wind'))
    if not 1<=radius<=500 or not .1<=diameter<=100 or not 1<=height<=1000 or wind!=int(wind) or not 1<=wind<=64:
        raise ValueError('Radius: 1–500 mm; diameter: 0.1–100 mm; height: 1–1000 mm; windings: integer 1–64')
    kind=value.get('type','cylinder')
    if kind not in ('cylinder','s-curve','hilbert','custom-step'):raise ValueError('Unsupported tube type')
    mapping=value.get('mapping','projection')
    if mapping!='projection':raise ValueError('Invalid mapping method')
    if kind=='hilbert' and wind>6:raise ValueError('Hilbert order must be between 1 and 6')
    source=value.get('source');reverse=value.get('reverse',False)
    if not isinstance(reverse,bool):raise ValueError('Invalid tube direction')
    if kind=='custom-step':
        if not isinstance(source,str) or not source or len(source.encode('utf-8'))>2097152:raise ValueError('Choose a STEP centerline up to 2 MB')
    elif source is not None or reverse:raise ValueError('This tube type does not accept STEP centerlines')
    center=value.get('center')
    if center is not None:
        if not isinstance(center,(list,tuple)) or len(center)!=3:raise ValueError('Tube center must be a 3D coordinate')
        center=tuple(finite(v,'center') for v in center)
        if any(abs(v)>1e6 for v in center):raise ValueError('Tube center is out of range')
    from .projection import settings
    placement=settings(value.get('placement'))
    return CylinderSettings(radius,diameter,height,int(wind),type=kind,mapping=mapping,placement=placement,source=source,reverse=reverse,center=center,initial_placement=settings(value.get('initial_placement')))


def cylinder_config(cylinder):
    result={n:getattr(cylinder,n) for n in ('radius','diameter','height','wind')}
    if cylinder.type!='cylinder':result['type']=cylinder.type
    if cylinder.mapping!='projection':result['mapping']=cylinder.mapping
    if cylinder.placement is not None:
        from .projection import config
        result['placement']=config(cylinder.placement)
    if cylinder.initial_placement is not None:
        from .projection import config
        result['initial_placement']=config(cylinder.initial_placement)
    if cylinder.type=='custom-step':result.update(source=cylinder.source,reverse=cylinder.reverse)
    if cylinder.center is not None:result['center']=cylinder.center
    return result

def raw_tube_path(c):
    if c.type=='custom-step':
        from .tube_step import step_path
        return step_path(c.source,c.reverse)
    if c.type=='hilbert':return hilbert_curve(width=2*c.radius,height=c.height,order=c.wind)
    if c.type=='s-curve':return s_curve(width=2*c.radius,height=c.height/2,wind=c.wind)
    return cylinder_spiral(radius=c.radius,diameter=c.diameter,height=c.height,wind=c.wind,samples_per_turn=c.samples_per_turn,period=c.period)

def path_bounds(path):
    from .cubic import unit_roots,CubicSpan
    from .geometry import UpwardSemicircle,CircularArc
    import math
    points=[]
    for piece in path.pieces:
        ts={0.,1.}
        if isinstance(piece,CubicSpan):
            for a,b,c,d in piece.coefficients:ts.update(unit_roots((b,2*c,3*d)))
        elif isinstance(piece,UpwardSemicircle):ts.add(.5)
        elif isinstance(piece,CircularArc):
            for k in range(-8,9):
                t=(k*math.pi/2-piece.start_angle)/piece.sweep
                if 0<t<1:ts.add(t)
        points.extend(piece.point_at(t) for t in ts)
    return tuple(tuple(f(p[i] for p in points) for i in range(3)) for f in (min,max))


def tube_path(c):
    path=raw_tube_path(c)
    if c.center is None:return path
    from .cubic import CubicSpan
    from .geometry import Line
    lo,hi=path_bounds(path);delta=tuple(c.center[i]-(lo[i]+hi[i])/2 for i in range(3))
    shift=lambda p:tuple(v+d for v,d in zip(p,delta))
    pieces=[]
    for piece in path.pieces:
        if isinstance(piece,CubicSpan):pieces.append(CubicSpan(tuple((v[0]+d,*v[1:]) for v,d in zip(piece.coefficients,delta))))
        elif isinstance(piece,Line):pieces.append(replace(piece,start=shift(piece.start),end=shift(piece.end)))
        else:pieces.append(replace(piece,center=shift(piece.center)))
    return replace(path,pieces=tuple(pieces))


@dataclass(frozen=True)
class SolvedDisplay:
    path: CubicPath | TubePath
    sequence: PhysicalSequence
    pattern_id: str


def pattern_bounds(width=30,height=45,x=25,z=15,*,cylinder=CylinderSettings()):
    values=tuple(finite(v,n) for n,v in [('width',width),('height',height),('x',x),('z',z)])
    width,height,x,z=values
    if width<=0 or height<=0 or x<0 or z<0 or x+width>2*cylinder.radius or z+height>cylinder.height:
        raise ValueError(f'Pattern bounds must be within X=0..{2*cylinder.radius:g}, Z=0..{cylinder.height:g} mm with positive width and height')
    return values


def pattern_frame(cylinder):
    if cylinder.placement and len(cylinder.placement)>5:
        width,height=cylinder.placement[5]
        return replace(cylinder,radius=width/2,height=height)
    return cylinder


def simulate_along_path(pattern,curve,cylinder):
    from .path_partition import region_for,along_path
    path=tube_path(cylinder)
    if pattern and pattern[0]=='spatial-brush':
        from .segments import partition_path
        from .spatial_brush import merge_short_segments
        sequence=partition_path(path,[(a*path.length,b*path.length) for a,b in pattern[1]])
        sequence=merge_short_segments(sequence)
        return SolvedDisplay(path,sequence,'spatial-brush')
    frame=pattern_frame(cylinder)
    region=region_for(pattern,frame)
    from .projection import projector
    transform=projector(cylinder.placement,2*frame.radius,frame.height) if cylinder.placement else None
    lo,hi=path_bounds(path)
    sequence=along_path(path,region,height_range=(lo[2],hi[2]),curve=curve,front_y=0 if transform else (cylinder.center[1] if cylinder.center else cylinder.radius) if cylinder.type=='cylinder' else None,projection=transform,back_y=-cylinder.placement[4] if cylinder.placement and len(cylinder.placement)>4 and cylinder.placement[4] is not None else None)
    return SolvedDisplay(path,sequence,'along-path')
