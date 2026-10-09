"""Direct path painting uses normalized arc-length intervals, without projection."""
import math


def validate_windows(windows):
    if not isinstance(windows,list) or len(windows)>10000:
        raise ValueError('Invalid spatial brush intervals')
    result=[]
    for item in windows:
        if not isinstance(item,list) or len(item)!=2 or any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in item):
            raise ValueError('Invalid spatial brush intervals')
        a,b=item
        if not 0<=a<b<=1 or (result and a<result[-1][1]):
            raise ValueError('Spatial brush intervals must be ordered and non-overlapping')
        result.append((a,b))
    return tuple(result)
