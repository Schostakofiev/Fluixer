"""Validate and decode deterministic binary brush masks."""
import json
from functools import lru_cache


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
