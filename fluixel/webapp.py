"""Local-only UI. Run: python -m fluixel.webapp [--port 8765] [--no-browser]."""
from . import __version__
from html import escape
import argparse
import csv
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit
import webbrowser
from .pipeline import path_bounds,pattern_frame,rectangle_settings,simulate_along_path,cylinder_settings,cylinder_config,CylinderSettings
from .geometry import UpwardSemicircle, CircularArc
from .compensation import curve_settings, curve_config
from .svg_input import parse_svg
from .step_input import parse_step
from .tube_step import parse_tube_step
from .brush_input import parse_brush
from .command_adapter import display_rows
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
    if isinstance(value,dict) and value.get('type') in ('svg','step','brush','image'):
        if set(value)!={'type','source','width','height','x','z'}:raise ValueError('Incomplete SVG pattern parameters')
        ({'step':parse_step,'svg':parse_svg,'brush':parse_brush,'image':parse_brush}[value['type']])(value['source'])
        return (value['type'],value['source'],*rectangle_settings(*(value[n] for n in ('width','height','x','z')),cylinder=cylinder))
    if not isinstance(value,dict) or set(value)!={'type','width','height','x','z'} or value['type']!='rectangle':
        raise ValueError('Invalid pattern settings')
    return rectangle_settings(*(value[n] for n in ('width','height','x','z')),cylinder=cylinder)


@lru_cache(maxsize=8)
def solved(mode,pattern=(),curve=curve_settings(),cylinder=CylinderSettings()):
    return simulate_along_path(pattern,mode,curve,cylinder)


@lru_cache(maxsize=8)
def preview(mode,pattern=(),curve=curve_settings(),cylinder=CylinderSettings()):
    display=solved(mode,pattern,curve,cylinder)
    # Tessellation is display-only. CSV continues to use exact physical lengths.
    samples=[(0.0,display.path.pieces[0].point_at(0))]
    distance=0.0
    for piece in display.path.pieces:
        count=36 if isinstance(piece,(UpwardSemicircle,CircularArc)) else 1
        for i in range(1,count+1):samples.append((distance+piece.length*i/count,piece.point_at(i/count)))
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
    return {'bounds':[list(p) for p in path_bounds(display.path)],'plane':plane,'cylinder':cylinder_config(cylinder),'compensation':curve_config(curve),'calibration':mode,'pattern':'Empty tube' if pattern==('empty',) else 'Image pattern' if pattern and pattern[0]=='image' else 'Brush pattern' if pattern and pattern[0]=='brush' else 'STEP region' if pattern and pattern[0]=='step' else 'SVG pattern' if pattern and pattern[0]=='svg' else 'Custom rectangle' if pattern else 'S · Full outline',
        'pattern_config':{'type':'spatial-brush','windows':[list(w) for w in pattern[1]]} if pattern and pattern[0]=='spatial-brush' else {'type':'empty'} if pattern==('empty',) else dict(type=pattern[0],source=pattern[1],**dict(zip(('width','height','x','z'),pattern[2:]))) if pattern and pattern[0] in ('svg','step','brush','image') else dict(type='rectangle',**dict(zip(('width','height','x','z'),pattern))) if pattern else {'type':'captured-s'},'length_unit':'mm',
        'path_length':display.path.length,'segments':segments,
        'liquid_length':sum(s.length for s in display.sequence.segments if s.phase=='liquid'),
        'contours':[[c.start,c.end] for c in display.contours]}


def csv_payload(data):
    allowed={'calibration','speed','k_gas','k_liquid','unit','pattern','compensation','cylinder','pre_add'}
    if not isinstance(data,dict) or set(data)-allowed:raise ValueError('Unknown export parameters')
    from .geometry import finite
    pre_add=finite(data.get('pre_add',730),'Pre-Add')
    if isinstance(data.get('pre_add'),bool) or not 0<=pre_add<=10000:raise ValueError('Pre-Add must be between 0 and 10000 mm')
    mode=data.get('calibration','original')
    if mode not in ('original','compensated'):raise ValueError('Invalid compensation mode')
    unit=data.get('unit','steps')
    if unit not in ('steps','segments'):raise ValueError('Invalid output unit')
    machine=MachineParameters(*(float(data.get(key,default)) for key,default in
        [('speed',400),('k_gas',606),('k_liquid',625)]))
    cylinder=cylinder_settings(data.get('cylinder'))
    pattern=pattern_key(data.get('pattern'),cylinder)
    rows=display_rows(solved(mode,pattern,curve_settings(data.get('compensation')),cylinder),machine=machine,unit=unit,pre_add=pre_add)
    stream=io.StringIO(newline='')
    writer=csv.writer(stream);writer.writerow(HEADER);writer.writerows(rows)
    return stream.getvalue().encode('utf-8-sig'),f'fluixel_{mode}_{unit}.csv',len(rows)


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass

    def send(self,status,body,content_type,extra=None):
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        for key,value in (extra or {}).items():self.send_header(key,value)
        self.end_headers();self.wfile.write(body)

    def error(self,status,message):
        self.send(status,json.dumps({'error':message},ensure_ascii=False).encode(), 'application/json; charset=utf-8')

    def local_request(self):
        expected=f'127.0.0.1:{self.server.server_port}'
        if self.headers.get('Host')!=expected:
            self.error(403,'Open this page using the local server address');return False
        origin=self.headers.get('Origin')
        if origin is not None and origin!=f'http://{expected}':
            self.error(403,'Request origin mismatch');return False
        return True

    def do_GET(self):
        if not self.local_request():return
        url=urlsplit(self.path)
        assets={'/image-input.js':('image-input.js','text/javascript'),'/':('index.html','text/html'),'/app.js':('app.js','text/javascript'),'/tube-renderer.js':('tube-renderer.js','text/javascript'),'/style.css':('style.css','text/css')}
        for asset in (Path(__file__).parent/'ui').glob('css/*.css'):
            assets['/css/'+asset.name]=('css/'+asset.name,'text/css')
        for asset in (Path(__file__).parent/'ui').glob('fonts/open/*.ttf'):
            assets['/fonts/open/'+asset.name]=('fonts/open/'+asset.name,'font/ttf')
        if url.path in assets:
            name,mime=assets[url.path]
            body=(Path(__file__).parent/'ui'/name).read_bytes()
            if name=='index.html':body=body.replace(b'{{VERSION}}',escape(__version__).encode('utf-8'))
            self.send(200,body,mime+'; charset=utf-8')
        elif url.path=='/api/display':
            mode=parse_qs(url.query).get('calibration',['original'])[0]
            if mode not in ('original','compensated'):self.error(400,'Invalid compensation mode');return
            try:
                params=parse_qs(url.query)
                config=None
                if params.get('pattern',['captured-s'])[0]!='captured-s':
                    config={'type':params['pattern'][0],**{n:params.get(n,[''])[0] for n in ('width','height','x','z')}}
                curve=curve_settings(json.loads(params['compensation'][0]) if 'compensation' in params else None)
                cylinder=cylinder_settings(json.loads(params['cylinder'][0]) if 'cylinder' in params else None)
                with _lock:payload=preview(mode,pattern_key(config,cylinder),curve,cylinder)
            except (ValueError,TypeError) as exc:self.error(400,str(exc));return
            self.send(200,json.dumps(payload).encode(),'application/json')
        else:self.error(404,'Page not found')

    def do_POST(self):
        if not self.local_request():return
        if self.path not in ('/api/image','/api/export','/api/svg','/api/step','/api/tube-step','/api/display'):self.error(404,'Endpoint not found');return
        try:
            count=int(self.headers.get('Content-Length','0'))
            if not 0<count<=4194304:raise ValueError('Request must not exceed 4 MB')
            data=json.loads(self.rfile.read(count))
            if self.path=='/api/image':
                if not isinstance(data,dict) or set(data)!={'source'}:raise ValueError('Invalid image parameters')
                from .image_input import photo_subject
                self.send(200,json.dumps(photo_subject(data['source'])).encode(),'application/json');return
            if self.path in ('/api/svg','/api/step','/api/tube-step'):
                if not isinstance(data,dict) or set(data)!={'source'}:raise ValueError('Invalid SVG request parameters')
                with _lock:payload=({'/api/step':parse_step,'/api/svg':parse_svg,'/api/tube-step':parse_tube_step}[self.path])(data['source'])
                self.send(200,json.dumps(payload).encode(),'application/json');return
            if self.path=='/api/display':
                if not isinstance(data,dict) or set(data)-{'calibration','pattern','compensation','cylinder','pre_add'}:raise ValueError('Invalid preview parameters')
                cylinder=cylinder_settings(data.get('cylinder'))
                with _lock:payload=preview(data.get('calibration','compensated'),pattern_key(data.get('pattern'),cylinder),curve_settings(data.get('compensation')),cylinder)
                self.send(200,json.dumps(payload).encode(),'application/json');return
            with _lock:body,name,rows=csv_payload(data)
        except (ValueError,TypeError,OverflowError) as exc:
            self.error(400,str(exc));return
        self.send(200,body,'text/csv; charset=utf-8',{'Content-Disposition':f'attachment; filename="{name}"','X-Row-Count':str(rows)})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    args=parser.parse_args()
    if not 0<=args.port<=65535:parser.error('port must be 0..65535')
    try:server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError as exc:parser.error(str(exc))
    address=f'http://127.0.0.1:{server.server_port}'
    print(f'Fluixel: {address}\nPress Ctrl+C to close.',flush=True)
    if not args.no_browser:webbrowser.open(address)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
