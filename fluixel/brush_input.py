"""Deterministic binary brush mask to physical scanline intervals."""
import json,math
from functools import lru_cache
from .pattern import Contour

SIZE=256
@lru_cache(maxsize=8)
def parse_brush(source):
    if not isinstance(source,str) or len(source)>70000:raise ValueError('Brush data is too large')
    try:data=json.loads(source)
    except (ValueError,TypeError) as e:raise ValueError('Invalid brush data') from e
    if not isinstance(data,dict) or set(data)!={'size','rows'} or type(data['size']) is not int or data['size']!=SIZE:raise ValueError('Invalid brush canvas format')
    rows=data['rows']
    if not isinstance(rows,list) or len(rows)!=SIZE or any(not isinstance(r,str) or len(r)!=SIZE or set(r)-{'0','1'} for r in rows):raise ValueError('Invalid brush pixel data')
    return tuple(rows)

def brush_contours(source,width,height,x,z,levels):
    rows=parse_brush(source);result=[]
    for layer,level in enumerate(levels):
        t=(level-z)/height
        if not 0<=t<1:continue
        row=rows[SIZE-1-min(SIZE-1,math.floor(t*SIZE))];start=None
        for i,value in enumerate(row+'0'):
            if value=='1' and start is None:start=i
            elif value=='0' and start is not None:
                result.append(Contour((x+start/SIZE*width,0,level),(x+i/SIZE*width,0,level),layer));start=None
    return tuple(result)
