"""Geometric compensation: normalized height -> X displacement in model units.

Separate from final machine conversion factors.
"""

from .geometry import finite
from bisect import bisect_right
from functools import lru_cache

DEFAULT_X = (0.0, 1.0 / 3, 2.0 / 3, 1.0)
DEFAULT_Y = (0.0, 0.0, 0.0, 0.0)


def bezier_value(x, control_x=DEFAULT_X, control_y=DEFAULT_Y):
    """Evaluate y at x by inverting a monotone Bezier curve's x coordinate.

    Restricted to endpoint x=0/1 and ordered x handles: ambiguous graphs fail.
    """
    x=finite(x,'normalized input')
    cx=tuple(finite(v,'control x') for v in control_x)
    cy=tuple(finite(v,'control y') for v in control_y)
    if not 2<=len(cx)<=12 or len(cy)!=len(cx) or cx[0]!=0 or cx[-1]!=1 or list(cx)!=sorted(cx):
        raise ValueError('requires 2 to 12 controls with monotone x from 0 to 1')
    if not 0<=x<=1: raise ValueError('normalized input outside [0,1]')
    if x==0:return cy[0]
    if x==1:return cy[-1]
    def evaluate(c,t):
        if len(c)==4:
            u=1-t
            return c[0]*u**3+3*c[1]*u*u*t+3*c[2]*u*t*t+c[3]*t**3
        values=list(c)
        while len(values)>1:values=[(1-t)*a+t*b for a,b in zip(values,values[1:])]
        return values[0]
    low,high=0.0,1.0
    for _ in range(60):
        t=(low+high)/2
        if evaluate(cx,t)<x:low=t
        else:high=t
    return evaluate(cy,(low+high)/2)


@lru_cache(maxsize=64)
def _pchip_slopes(xs, ys):
    h=tuple(b-a for a,b in zip(xs,xs[1:]));d=tuple((b-a)/w for a,b,w in zip(ys,ys[1:],h))
    if len(xs)==2:return (d[0],d[0])
    def end(h0,h1,d0,d1):
        v=((2*h0+h1)*d0-h0*d1)/(h0+h1)
        if v*d0<=0:return 0.0
        if d0*d1<=0 and abs(v)>3*abs(d0):return 3*d0
        return v
    m=[end(h[0],h[1],d[0],d[1])]
    for i in range(1,len(xs)-1):
        w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1]
        m.append(0.0 if d[i-1]*d[i]<=0 else (w1+w2)/(w1/d[i-1]+w2/d[i]))
    m.append(end(h[-1],h[-2],d[-1],d[-2]))
    return tuple(m)


def curve_value(x, key):
    """Evaluate normalized compensation. Photo knots use shape-preserving interpolation."""
    _,cx,cy=key[:3]
    if len(key)==3:return bezier_value(x,cx,cy)
    x=finite(x,'normalized input')
    if not 0<=x<=1:raise ValueError('normalized input outside [0,1]')
    if x==0:return cy[0]
    if x==1:return cy[-1]
    i=min(len(cx)-2,bisect_right(cx,x)-1);h=cx[i+1]-cx[i];t=(x-cx[i])/h
    m=_pchip_slopes(cx,cy)
    return (2*t**3-3*t*t+1)*cy[i]+(t**3-2*t*t+t)*h*m[i]+(-2*t**3+3*t*t)*cy[i+1]+(t**3-t*t)*h*m[i+1]


def curve_settings(value=None):
    if value is None:return (40.0, DEFAULT_X, DEFAULT_Y)
    if not isinstance(value,dict) or set(value) not in ({'amplitude','x','y'},{'amplitude','x','y','interpolation'}):
        raise ValueError('Incomplete compensation curve parameters')
    interpolated='interpolation' in value
    if interpolated and value['interpolation']!='pchip':raise ValueError('Unknown compensation interpolation')
    amplitude=finite(value['amplitude'],'amplitude')
    if not -80<=amplitude<=80:raise ValueError('Compensation amplitude must be within -80–80 mm')
    if not isinstance(value['x'],(list,tuple)) or not isinstance(value['y'],(list,tuple)):
        raise ValueError('Curve coordinates must be arrays')
    cx=tuple(finite(v,'x') for v in value['x']);cy=tuple(finite(v,'y') for v in value['y'])
    if interpolated:
        if not 2<=len(cx)<=256 or len(cx)!=len(cy) or cx[0]!=0 or cx[-1]!=1 or any(a>=b for a,b in zip(cx,cx[1:])):
            raise ValueError('Interpolation requires 2 to 256 points with strictly increasing X from 0 to 1')
    else:bezier_value(0.5,cx,cy)
    if any(v<-1 or v>1 for v in cy):raise ValueError('Curve Y values must be within -1–1')
    return (amplitude,cx,cy,'pchip') if interpolated else (amplitude,cx,cy)


def curve_config(key):
    result={'amplitude':key[0],'x':list(key[1]),'y':list(key[2])}
    if len(key)==4:result['interpolation']=key[3]
    return result
