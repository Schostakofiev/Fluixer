"""Directional projection onto a transformed XZ pattern plane."""
import math
from .geometry import finite

def settings(value):
    if value is None:return None
    if not isinstance(value,dict) or (not {'position','rotation','scale','direction'}<=set(value) or set(value)-{'position','rotation','scale','direction','depth','size'}):raise ValueError('Incomplete projection parameters')
    out=[]
    for name in ('position','rotation','scale','direction'):
        v=value[name]
        if not isinstance(v,(list,tuple)) or len(v)!=3:raise ValueError('Projection parameters must be 3D vectors')
        out.append(tuple(finite(x,name) for x in v))
    p,r,s,d=out
    if any(abs(x)>10000 for x in p+r) or any(not .01<=x<=100 for x in s):raise ValueError('Projection transform is out of range')
    if math.hypot(*d)<1e-8:raise ValueError('Projection direction must be nonzero')
    depth=finite(value['depth'],'depth') if 'depth' in value else None
    if depth is not None and not 0<depth<=10000:raise ValueError('Projection depth must be positive and at most 10000 mm')
    size=value.get('size')
    if size is not None:
        if not isinstance(size,(list,tuple)) or len(size)!=2:raise ValueError('Plane size must contain width and height')
        size=tuple(finite(x,'size') for x in size)
        if any(not 0<x<=10000 for x in size):raise ValueError('Plane dimensions are out of range')
    result=tuple(out)+(depth,)+((size,) if size is not None else ());projector(result,1,1)
    return result

def config(value):
    result=dict(zip(('position','rotation','scale','direction'),value))
    if len(value)>4 and value[4] is not None:result['depth']=value[4]
    if len(value)>5:result['size']=value[5]
    return result
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def rotate(p,r):
    x,y,z=p
    for axis,angle in enumerate(r):
        c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle))
        if axis==0:y,z=y*c-z*s,y*s+z*c
        elif axis==1:x,z=x*c+z*s,-x*s+z*c
        else:x,y=x*c-y*s,x*s+y*c
    return x,y,z

def projector(value,width,height):
    p,r,s,d=value[:4]
    u,v,n=rotate((1,0,0),r),rotate((0,0,1),r),rotate((0,1,0),r)
    norm=math.hypot(*d);d=tuple(x/norm for x in d);den=dot(d,n)
    if abs(den)<.02:raise ValueError('Projection direction is nearly parallel to the pattern plane. Adjust the arrow')
    def transform(q):
        rel=tuple(a-b for a,b in zip(q,p));t=dot(rel,n)/den
        foot=tuple(a-t*b for a,b in zip(rel,d))
        return dot(foot,u)/s[0]+width/2,dot(foot,v)/s[2]+height/2,-t
    return transform
