"""Saved GH Bezier graph: branch ordinal -> X displacement in model units.

Separate from final machine k factors and the historical Cdiff calculation.
"""
from dataclasses import replace
from .geometry import finite

SAVED_X = (0.0, 0.0, 0.9918989539146423, 1.0)
SAVED_Y = (0.5957211256027222, 0.0, 0.0, 0.0)


def bezier_value(x, control_x=SAVED_X, control_y=SAVED_Y):
    """Evaluate y at x by inverting a monotone cubic Bezier's x coordinate.

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
    if value is None:return (40.0, SAVED_X, SAVED_Y)
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


def branch_offsets(count, amplitude=40, control_x=SAVED_X, control_y=SAVED_Y):
    """Map occupied branch ordinals to the saved graph and target [0,amplitude].

    A single branch has a collapsed GH source domain; behavior is unverified,
    so it is rejected instead of silently assigning an arbitrary displacement.
    """
    if type(count) is not int or count<0:raise ValueError('invalid branch count')
    amplitude=finite(amplitude,'amplitude')
    if count==0:return ()
    if count==1:raise ValueError('single-branch GH remap is not verified')
    return tuple(amplitude*bezier_value(i/(count-1),control_x,control_y) for i in range(count))


def compensate_contours(contours, *, amplitude=40, branch_order=None, control_x=SAVED_X, control_y=SAVED_Y):
    """Shift paired endpoints once per occupied branch, preserving input order.

    By default ascending integer layer order matches polygon_contours output.
    Pass branch_order explicitly to preserve a different source tree ordering.
    """
    contours=tuple(contours)
    layers={c.layer for c in contours}
    order=tuple(sorted(layers)) if branch_order is None else tuple(branch_order)
    if len(order)!=len(set(order)) or set(order)!=layers:
        raise ValueError('branch order must list each occupied layer exactly once')
    # #239 output has ReverseData=true, before #238 grafts the motion input.
    offsets=dict(zip(order,reversed(branch_offsets(len(order),amplitude,control_x,control_y))))
    result=[]
    for c in contours:
        points=[]
        for point in (c.start,c.end):
            point=tuple(finite(v,'contour coordinate') for v in point)
            if len(point)!=3:raise ValueError('endpoint must have three coordinates')
            points.append((point[0]+offsets[c.layer],point[1],point[2]))
        result.append(replace(c,start=points[0],end=points[1]))
    return tuple(result)
