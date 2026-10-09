"""Partition a continuous path by planar area membership, never endpoint pairs.

Path and compensation are tessellated to 0.01 mm chord error, with a 0.5 mm
maximum arc-length step when compensation is active. Every resulting chord is split at region boundaries.
"""
import math
from functools import lru_cache
from .segments import partition_path
from .compensation import bezier_value

TOLERANCE=.01
MAX_SAMPLES=200000

def cross(a,b):return a[0]*b[1]-a[1]*b[0]

def lerp(a,b,t):return tuple(x+(y-x)*t for x,y in zip(a,b))

class PolygonRegion:
    def __init__(self,groups):
        self.groups=groups
        self.edges=[(a,b) for _,rings in groups for ring in rings for a,b in zip(ring,ring[1:]+ring[:1])]
    @lru_cache(maxsize=4096)
    def intervals(self,z):
        result=[]
        for rule,rings in self.groups:
            hits=[]
            for ring in rings:
                for a,b in zip(ring,ring[1:]+ring[:1]):
                    if min(a[1],b[1])<=z<max(a[1],b[1]):hits.append((a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]),1 if b[1]>a[1] else -1))
            hits.sort();winding=0;previous=None
            for x,delta in hits:
                if previous is not None and (winding%2 if rule=='evenodd' else winding!=0):result.append((previous,x))
                winding+=delta;previous=x
        return result
    def contains(self,p):return any(a<=p[0]<b for a,b in self.intervals(p[1]))
    def cuts(self,a,b):
        d=(b[0]-a[0],b[1]-a[1]);result=[]
        for c,e in self.edges:
            if max(a[0],b[0])<min(c[0],e[0]) or min(a[0],b[0])>max(c[0],e[0]) or max(a[1],b[1])<min(c[1],e[1]) or min(a[1],b[1])>max(c[1],e[1]):continue
            v=(e[0]-c[0],e[1]-c[1]);w=(c[0]-a[0],c[1]-a[1]);den=cross(d,v)
            if abs(den)>1e-14:
                t,u=cross(w,v)/den,cross(w,d)/den
                if 0<t<1 and -1e-10<=u<=1+1e-10:result.append(t)
            elif abs(cross(w,d))<1e-12:
                axis=0 if abs(d[0])>=abs(d[1]) else 1
                if d[axis]:
                    for p in (c,e):
                        t=(p[axis]-a[axis])/d[axis]
                        if 0<t<1:result.append(t)
        return result

class MaskRegion:
    def __init__(self,rows,width,height,x,z):self.rows=rows;self.width=width;self.height=height;self.x=x;self.z=z
    def contains(self,p):
        u=(p[0]-self.x)/self.width;v=(p[1]-self.z)/self.height
        return 0<=u<1 and 0<=v<1 and self.rows[255-min(255,int(v*256))][min(255,int(u*256))]=='1'
    def cuts(self,a,b):
        cuts=[]
        for axis,start,size in ((0,self.x,self.width),(1,self.z,self.height)):
            delta=b[axis]-a[axis]
            if delta:
                lo=max(0,math.ceil((min(a[axis],b[axis])-start)/size*256))
                hi=min(256,math.floor((max(a[axis],b[axis])-start)/size*256))
                for k in range(lo,hi+1):
                    t=(start+size*k/256-a[axis])/delta
                    if 0<t<1:cuts.append(t)
        return cuts

def region_for(pattern,c):
    if not pattern:
        from .s_pattern import boundary,value
        spans,center=boundary();ring=[]
        for x,z in spans:
            # Exact quadratic midpoint deviation is |quadratic coefficient|/4.
            count=max(1,math.ceil(math.sqrt(math.hypot(x[2],z[2])/(4*TOLERANCE))))
            for i in range(count):ring.append((value(x,i/count)+c.radius-center[0],value(z,i/count)+c.height/2-center[1]))
        return PolygonRegion((('nonzero',(tuple(ring),)),))
    kind=pattern[0]
    if kind=='empty':return PolygonRegion(())
    if kind in ('brush','image'):
        from .brush_input import parse_brush
        return MaskRegion(parse_brush(pattern[1]),*pattern[2:])
    if kind in ('step','svg'):
        from .step_input import parse_step
        from .svg_input import parse_svg
        data=(parse_step if kind=='step' else parse_svg)(pattern[1]);w,h,x,z=pattern[2:]
        return PolygonRegion(tuple((rule,tuple(tuple((x+a*w,z+b*h) for a,b in ring) for ring in rings)) for rule,rings in data['groups']))
    w,h,x,z=pattern
    return PolygonRegion((('nonzero',(((x,z),(x+w,z),(x+w,z+h),(x,z+h)),)),))

def along_path(path,region,*,height,curve,front_y=None,projection=None,back_y=None):
    amp,cx,cy=curve
    offsets=[amp*bezier_value(1-i/256,cx,cy) for i in range(257)] if amp and any(cy) else [0]*257
    def transform(p):
        if projection:
            x,z,depth=projection(p)
            p=(x,depth,z)
        u=max(0,min(256,p[2]/height*256));k=min(255,int(u));off=offsets[k]+(offsets[k+1]-offsets[k])*(u-k)
        return (p[0]-off,p[2],p[1])
    windows=[];samples=0
    def segment(sa,sb,a,b,depth=0):
        nonlocal samples
        samples+=1
        if samples>MAX_SAMPLES:raise ValueError('Along-path calculation is too complex. Reduce tube count or dimensions')
        mid=(sa+sb)/2;m=transform(path.point_at_distance(mid))
        errors=[math.dist(m,lerp(a,b,.5))]
        for t in (.25,.75):errors.append(math.dist(transform(path.point_at_distance(sa+(sb-sa)*t)),lerp(a,b,t)))
        if (amp and any(cy) and sb-sa>.5) or max(errors)>TOLERANCE:
            if depth>=24:raise ValueError('Could not meet along-path accuracy requirements')
            segment(sa,mid,a,m,depth+1);segment(mid,sb,m,b,depth+1);return
        cuts=[0.,1.]+region.cuts(a[:2],b[:2])
        if front_y is not None and b[2]!=a[2]:
            t=(front_y-a[2])/(b[2]-a[2])
            if 0<t<1:cuts.append(t)
        if back_y is not None and b[2]!=a[2]:
            t=(back_y-a[2])/(b[2]-a[2])
            if 0<t<1:cuts.append(t)
        cuts=sorted(set(cuts))
        for lo,hi in zip(cuts,cuts[1:]):
            p=lerp(a,b,(lo+hi)/2)
            if region.contains(p[:2]) and (front_y is None or p[2]<=front_y) and (back_y is None or p[2]>=back_y):
                start,end=sa+(sb-sa)*lo,sa+(sb-sa)*hi
                if end-start>1e-10:
                    if windows and start-windows[-1][1]<1e-9:windows[-1]=(windows[-1][0],end)
                    else:windows.append((start,end))
    start=0.
    for piece in path.pieces:
        end=min(path.length,start+piece.length)
        segment(start,end,transform(path.point_at_distance(start)),transform(path.point_at_distance(end)));start=end
    return partition_path(path,windows)
