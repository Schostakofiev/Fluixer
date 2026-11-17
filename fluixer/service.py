"""Shared application operations and public UI resources for both HTTP hosts."""
import csv
import io
import json
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from html import escape
from pathlib import Path
from typing import Callable
from . import __version__, image_input, obstacle_step, pipe_step, step_input, print_preview, standard_leveling
from .pipeline import path_bounds,pattern_frame,pattern_bounds,simulate_along_path,cylinder_settings,cylinder_config,CylinderSettings
from .geometry import UpwardSemicircle, CircularArc
from .cubic import CubicSpan
from .compensation import curve_settings, curve_config
from .step_input import parse_step
from .brush_input import parse_brush
from .command_adapter import display_plan
from .export import HEADER, MachineParameters

_lock=threading.RLock()

def pattern_key(value=None,cylinder=CylinderSettings()):
    cylinder=pattern_frame(cylinder)
    if value is None or value=={'type':'captured-s'}:return ()
    if value=={'type':'empty'}:return ('empty',)
    if isinstance(value,dict) and value.get('type')=='spatial-brush':
        from .spatial_brush import validate_windows
        if set(value)!={'type','windows'}:raise ValueError('Invalid spatial brush parameters')
        return ('spatial-brush',validate_windows(value['windows']))
    if isinstance(value,dict) and value.get('type') in ('step','brush','image'):
        if set(value)!={'type','source','width','height','x','z'}:raise ValueError('Incomplete pattern parameters')
        ({'step':parse_step,'brush':parse_brush,'image':parse_brush}[value['type']])(value['source'])
        return (value['type'],value['source'],*pattern_bounds(*(value[n] for n in ('width','height','x','z')),cylinder=cylinder))
    raise ValueError('Unsupported pattern type')


@lru_cache(maxsize=8)
def solved(pattern=(),curve=curve_settings(),cylinder=CylinderSettings()):
    return simulate_along_path(pattern,curve,cylinder)


@lru_cache(maxsize=8)
def preview(pattern=(),curve=curve_settings(),cylinder=CylinderSettings()):
    display=solved(pattern,curve,cylinder)
    # Tessellation is display-only. CSV continues to use exact physical lengths.
    samples=[(0.0,display.path.pieces[0].point_at(0))]
    distance=0.0
    for piece in display.path.pieces:
        count=36 if isinstance(piece,(UpwardSemicircle,CircularArc)) else 8 if cylinder.type=="interactive" and isinstance(piece,CubicSpan) else 1
        for i in range(1,count+1):
            t=i/count
            offset=piece.length_to(t) if cylinder.type=='interactive' and isinstance(piece,CubicSpan) else piece.length*t
            samples.append((distance+offset,piece.point_at(t)))
        distance+=piece.length
    segments=[]
    cursor=0
    for segment in display.sequence.segments:
        points=[display.path.point_at_distance(segment.start_distance)]
        while cursor<len(samples) and samples[cursor][0]<segment.end_distance:
            if samples[cursor][0]>segment.start_distance:points.append(samples[cursor][1])
            cursor+=1
        points.append(display.path.point_at_distance(segment.end_distance))
        segments.append({'phase':segment.phase,'length':segment.length,'points':points})
    plane=[]
    if cylinder.placement is not None and not (pattern and pattern[0]=='spatial-brush'):
        from .path_partition import region_for
        frame=pattern_frame(cylinder)
        region=region_for(pattern,frame)
        for row in range(128):
            z=(row+.5)*frame.height/128
            if hasattr(region,'intervals'):
                plane.extend([[a,z,b,z] for a,b in region.intervals(z)])
            else:
                start=None
                for col in range(257):
                    inside=col<256 and region.contains(((col+.5)*2*frame.radius/256,z))
                    if inside and start is None:start=col*2*frame.radius/256
                    if not inside and start is not None:plane.append([start,z,col*2*frame.radius/256,z]);start=None
    return {'bounds':[list(p) for p in path_bounds(display.path)],'plane':plane,'cylinder':cylinder_config(cylinder),'compensation':curve_config(curve),'pattern':'Empty pipe' if pattern==('empty',) else 'Image pattern' if pattern and pattern[0]=='image' else 'Brush pattern' if pattern and pattern[0]=='brush' else 'STEP region' if pattern and pattern[0]=='step' else 'Spatial brush' if pattern and pattern[0]=='spatial-brush' else 'S 路 Full outline',
        'pattern_config':{'type':'spatial-brush','windows':[list(w) for w in pattern[1]]} if pattern and pattern[0]=='spatial-brush' else {'type':'empty'} if pattern==('empty',) else dict(type=pattern[0],source=pattern[1],**dict(zip(('width','height','x','z'),pattern[2:]))) if pattern and pattern[0] in ('step','brush','image') else {'type':'captured-s'},'length_unit':'mm',
        'path_length':display.path.length,'segments':segments,
        'liquid_length':sum(s.length for s in display.sequence.segments if s.phase=='liquid')}


def display_payload(data):
    if not isinstance(data,dict) or set(data)-{'pattern','compensation','cylinder','pre_add'}:
        raise ValueError('Invalid preview parameters')
    cylinder=cylinder_settings(data.get('cylinder'))
    return preview(pattern_key(data.get('pattern'),cylinder),curve_settings(data.get('compensation')),cylinder)


def output_plan_payload(data, *, include_timing=True):
    allowed={'speed','k_gas','k_liquid','unit','pattern','compensation','cylinder','pre_add','length_per_100_steps'}
    if not isinstance(data,dict) or set(data)-allowed:raise ValueError('Unknown export parameters')
    from .geometry import finite
    pre_add=finite(data.get('pre_add',730),'Pre-Add')
    if isinstance(data.get('pre_add'),bool) or not 0<=pre_add<=10000:raise ValueError('Pre-Add must be between 0 and 10000 mm')
    step_length=finite(data.get('length_per_100_steps',9.65),'100 Steps Length')
    if isinstance(data.get('length_per_100_steps'),bool) or step_length<=0:raise ValueError('100 Steps Length must be a positive number in mm')
    unit=data.get('unit','steps')
    if unit not in ('steps','segments'):raise ValueError('Invalid output unit')
    machine=MachineParameters(*(float(data.get(key,default)) for key,default in
        [('speed',400),('k_gas',606),('k_liquid',625)]))
    cylinder=cylinder_settings(data.get('cylinder'))
    pattern=pattern_key(data.get('pattern'),cylinder)
    display=solved(pattern,curve_settings(data.get('compensation')),cylinder)
    plan=display_plan(display,machine=machine,unit=unit,pre_add=pre_add,length_per_100_steps=step_length)
    # Playback timing is independent of export units and never includes the extension.
    if include_timing:
        timing=display_plan(display,machine=machine,unit='steps',pre_add=0,length_per_100_steps=step_length)
        plan['timing']=[dict(command,speed=int(machine.speed)) for command in timing['commands']]
    return plan


def csv_payload(data):
    plan=output_plan_payload(data,include_timing=False)
    rows=plan['rows'];unit=data.get('unit','steps')
    stream=io.StringIO(newline='')
    writer=csv.writer(stream);writer.writerow(HEADER);writer.writerows(rows)
    return stream.getvalue().encode('utf-8-sig'),f'fluixer_{unit}.csv',len(rows)


@dataclass(frozen=True)
class HttpPayload:
    body: bytes
    content_type: str
    headers: dict = field(default_factory=dict)


def json_payload(data):
    return HttpPayload(json.dumps(data,ensure_ascii=False).encode('utf-8'),'application/json; charset=utf-8')


def source_field(data):
    if set(data)!={'source'}:raise ValueError('Expected a source field')
    return data['source']


def export_response(data):
    body,name,rows=csv_payload(data)
    return HttpPayload(body,'text/csv; charset=utf-8',
        {'Content-Disposition':f'attachment; filename="{name}"','X-Row-Count':str(rows)})


@dataclass(frozen=True)
class Operation:
    handler: Callable
    locked: bool = True


# Add or remove an application endpoint here; both hosts use this registry.
OPERATIONS = {
    'display': Operation(lambda data:json_payload(display_payload(data))),
    'output-plan': Operation(lambda data:json_payload(output_plan_payload(data))),
    'export': Operation(export_response),
    'calibration-standard': Operation(lambda data:json_payload(standard_leveling.standard_plan_payload(data))),
    'image': Operation(lambda data:json_payload(image_input.photo_subject(source_field(data))),locked=False),
    'step': Operation(lambda data:json_payload(step_input.parse_step(source_field(data)))),
    'pipe-step': Operation(lambda data:json_payload(pipe_step.parse_pipe_step(source_field(data)))),
    'obstacle-step': Operation(lambda data:json_payload(obstacle_step.parse_obstacle_step(source_field(data)))),
    'print-preview': Operation(lambda data:json_payload(print_preview.print_payload(data))),
    'print-step': Operation(lambda data:HttpPayload(print_preview.print_step_payload(data),'application/step',
        {'Content-Disposition':'attachment; filename="fluixer-print.step"'})),
}


def dispatch(operation,data):
    if not isinstance(data,dict):raise ValueError('Request body must be a JSON object')
    endpoint=OPERATIONS[operation]
    if not endpoint.locked:return endpoint.handler(data)
    with _lock:return endpoint.handler(data)


UI_ROOT = Path(__file__).parent/'ui'
# Public resources are indexed once, rather than scanned on every request.
ASSETS = {name:'text/javascript; charset=utf-8' for name in (
    'quick-guide.js','motion-12.23.24.js','obstacle.js','interactive-constraints.js',
    'serial-controller.js','csv-commands.js','app.js','history.js','image-input.js',
    'visual-calibration.js','pipe-renderer.js')}
ASSETS.update({'':'text/html; charset=utf-8','style.css':'text/css; charset=utf-8',
    'motion-LICENSE.txt':'text/plain; charset=utf-8','images/calibration-guide.jpg':'image/jpeg'})
for pattern,mime in [('css/*.css','text/css; charset=utf-8'),('svg/*.svg','image/svg+xml'),
                     ('fonts/open/*.ttf','font/ttf'),('fonts/open/*.txt','text/plain; charset=utf-8')]:
    ASSETS.update({p.relative_to(UI_ROOT).as_posix():mime for p in UI_ROOT.glob(pattern)})


def asset_payload(name):
    mime=ASSETS.get(name)
    if mime is None:return None
    path=(UI_ROOT/(name or 'index.html')).resolve()
    if not path.is_relative_to(UI_ROOT.resolve()) or not path.is_file():return None
    body=path.read_bytes()
    if not name:body=body.replace(b'{{VERSION}}',escape(__version__).encode('utf-8'))
    return HttpPayload(body,mime)
