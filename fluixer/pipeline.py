"""Independent simulation entry point, with a deliberately fixed captured S preset.

No machine parameters or export units enter the simulation result.
"""
from dataclasses import dataclass, replace
import json
from pathlib import Path
from .cubic import CubicPath, cylinder_spiral
from .pattern import Contour, project_contours, polygon_contours
from .geometry import finite, s_curve, hilbert_curve, TubePath
from .compensation import compensate_contours, curve_settings
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
    if mapping not in ('projection','path'):raise ValueError('Invalid mapping method')
    if mapping=='path':mapping='projection' # Migrate the former algorithm selector.
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


def slice_levels(c):
    rows=c.wind*(2 if c.type=='s-curve' else 1)
    return [i*c.height/rows for i in range(rows+1)]


@dataclass(frozen=True)
class SolvedDisplay:
    path: CubicPath | TubePath
    contours: tuple[Contour, ...]
    sequence: PhysicalSequence
    calibration: str
    pattern_id: str


def simulate_captured_s(*, calibration='original', cylinder=CylinderSettings(), compensation=None):
    """Slice the GH planar S boundary for the selected cylinder, in mm.

    The decoded boundary is centered by its area centroid, then sliced at
    height/wind spacing. This supports the saved planar S, not arbitrary Breps.
    """
    if calibration not in ('original','compensated'):
        raise ValueError('calibration must be original or compensated')
    from .s_pattern import s_contours
    contours=s_contours(cylinder.radius,cylinder.height,cylinder.wind*(2 if cylinder.type=='s-curve' else 1))
    if not contours:raise ValueError('Tube slices do not intersect the S pattern. Adjust height or windings')
    curve=curve_settings(compensation)
    if calibration=='compensated' and curve[0]!=0 and any(curve[2]):
        contours=compensate_contours(contours,amplitude=curve[0],control_x=curve[1],control_y=curve[2])
    path=tube_path(cylinder)
    return SolvedDisplay(path,contours,project_contours(path,contours),calibration,'captured-s-cylinder-20260923')


def rectangle_settings(width=30,height=45,x=25,z=15,*,cylinder=CylinderSettings()):
    values=tuple(finite(v,n) for n,v in [('width',width),('height',height),('x',x),('z',z)])
    width,height,x,z=values
    if width<=0 or height<=0 or x<0 or z<0 or x+width>2*cylinder.radius or z+height>cylinder.height:
        raise ValueError(f'Rectangle must be within X=0..{2*cylinder.radius:g}, Z=0..{cylinder.height:g} mm with positive width and height')
    return values


def simulate_rectangle(*,calibration='original',width=30,height=45,x=25,z=15,compensation=None,cylinder=CylinderSettings()):
    """Dynamic polygon example on the fixed cylinder; not native Brep parity."""
    width,height,x,z=rectangle_settings(width,height,x,z,cylinder=cylinder)
    if calibration not in ('original','compensated'):raise ValueError('Invalid compensation mode')
    rings=[[(x,z),(x+width,z),(x+width,z+height),(x,z+height)]]
    contours=polygon_contours(rings,slice_levels(cylinder))
    if not contours:raise ValueError('Rectangle does not intersect any slices. Increase its height or adjust its bottom position')
    curve=curve_settings(compensation)
    if calibration=='compensated' and curve[0]!=0 and any(curve[2]):
        if len({c.layer for c in contours})<2:raise ValueError('Compensation requires at least two slices. Increase the height')
        contours=compensate_contours(contours,amplitude=curve[0],control_x=curve[1],control_y=curve[2])
    path=tube_path(cylinder)
    return SolvedDisplay(path,contours,project_contours(path,contours),calibration,'rectangle')


def simulate_svg(source,*,width,height,x,z,calibration='compensated',compensation=None,cylinder=CylinderSettings()):
    from .svg_input import svg_contours
    if calibration not in ('original','compensated'):raise ValueError('Invalid compensation mode')
    width,height,x,z=rectangle_settings(width,height,x,z,cylinder=cylinder)
    contours=svg_contours(source,width,height,x,z,slice_levels(cylinder))
    if not contours:raise ValueError('SVG does not intersect any slices. Adjust its size or position')
    curve=curve_settings(compensation)
    if calibration=='compensated' and curve[0]!=0 and any(curve[2]):
        if len({c.layer for c in contours})<2:raise ValueError('Nonzero compensation requires at least two slices')
        contours=compensate_contours(contours,amplitude=curve[0],control_x=curve[1],control_y=curve[2])
    path=tube_path(cylinder)
    return SolvedDisplay(path,contours,project_contours(path,contours),calibration,'svg')


def simulate_step(source,*,width,height,x,z,calibration='compensated',compensation=None,cylinder=CylinderSettings()):
    from .step_input import step_contours
    if calibration not in ('original','compensated'):raise ValueError('Invalid compensation mode')
    width,height,x,z=rectangle_settings(width,height,x,z,cylinder=cylinder)
    contours=step_contours(source,width,height,x,z,slice_levels(cylinder))
    if not contours:raise ValueError('STEP does not intersect any slices. Adjust its size or position')
    curve=curve_settings(compensation)
    if calibration=='compensated' and curve[0]!=0 and any(curve[2]):
        if len({c.layer for c in contours})<2:raise ValueError('Nonzero compensation requires at least two slices')
        contours=compensate_contours(contours,amplitude=curve[0],control_x=curve[1],control_y=curve[2])
    path=tube_path(cylinder)
    return SolvedDisplay(path,contours,project_contours(path,contours),calibration,'step')


def simulate_brush(source,*,width,height,x,z,calibration='compensated',compensation=None,cylinder=CylinderSettings()):
    from .brush_input import brush_contours
    if calibration not in ('original','compensated'):raise ValueError('Invalid compensation mode')
    width,height,x,z=rectangle_settings(width,height,x,z,cylinder=cylinder)
    contours=brush_contours(source,width,height,x,z,slice_levels(cylinder))
    curve=curve_settings(compensation)
    if contours and calibration=='compensated' and curve[0]!=0 and any(curve[2]):
        if len({c.layer for c in contours})<2:raise ValueError('Nonzero compensation requires at least two slices')
        contours=compensate_contours(contours,amplitude=curve[0],control_x=curve[1],control_y=curve[2])
    path=tube_path(cylinder)
    return SolvedDisplay(path,contours,project_contours(path,contours),calibration,'brush')


def simulate_empty(calibration='compensated',cylinder=CylinderSettings()):
    if calibration not in ('original','compensated'):raise ValueError('Invalid compensation mode')
    path=tube_path(cylinder)
    return SolvedDisplay(path,(),project_contours(path,()),calibration,'empty')


def pattern_frame(cylinder):
    if cylinder.placement and len(cylinder.placement)>5:
        width,height=cylinder.placement[5]
        return replace(cylinder,radius=width/2,height=height)
    return cylinder


def simulate_along_path(pattern,calibration,curve,cylinder):
    from .path_partition import region_for,along_path
    if calibration not in ('original','compensated'):raise ValueError('Invalid compensation mode')
    path=tube_path(cylinder)
    if pattern and pattern[0]=='spatial-brush':
        from .segments import partition_path
        sequence=partition_path(path,[(a*path.length,b*path.length) for a,b in pattern[1]])
        return SolvedDisplay(path,(),sequence,calibration,'spatial-brush')
    effective=curve if calibration=='compensated' else (0,curve[1],curve[2])
    frame=pattern_frame(cylinder)
    region=region_for(pattern,frame)
    from .projection import projector
    transform=projector(cylinder.placement,2*frame.radius,frame.height) if cylinder.placement else None
    sequence=along_path(path,region,height=frame.height,curve=effective,front_y=0 if transform else (cylinder.center[1] if cylinder.center else cylinder.radius) if cylinder.type=='cylinder' else None,projection=transform,back_y=-cylinder.placement[4] if cylinder.placement and len(cylinder.placement)>4 and cylinder.placement[4] is not None else None)
    return SolvedDisplay(path,(),sequence,calibration,'along-path')
