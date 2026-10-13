"""Geometric compensation: normalized height -> X displacement in model units.

Separate from final machine conversion factors.
"""

from .geometry import finite

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


def curve_settings(value=None):
    if value is None:return (40.0, DEFAULT_X, DEFAULT_Y)
    if not isinstance(value,dict) or set(value)!={'amplitude','x','y'}:
        raise ValueError('Incomplete compensation curve parameters')
    amplitude=finite(value['amplitude'],'amplitude')
    if not -80<=amplitude<=80:raise ValueError('Compensation amplitude must be within -80–80 mm')
    cx=tuple(finite(v,'x') for v in value['x']);cy=tuple(finite(v,'y') for v in value['y'])
    bezier_value(0.5,cx,cy)
    if any(v<-1 or v>1 for v in cy):raise ValueError('Curve Y values must be within -1–1')
    return (amplitude,cx,cy)


def curve_config(key):
    return {'amplitude':key[0],'x':list(key[1]),'y':list(key[2])}
