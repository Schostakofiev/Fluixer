"""Planar S boundary decoded from GH object 71; exact linear/quadratic spans."""
import bisect,json,math
from functools import lru_cache
from pathlib import Path
from .pattern import Contour

def point(curve,t):
    p=curve['degree'];knots=[curve['knots'][0]]+curve['knots']+[curve['knots'][-1]]
    k=min(len(curve['points'])-1,bisect.bisect_right(knots,t)-1)
    d=[list(curve['points'][j+k-p]) for j in range(p+1)]
    for r in range(1,p+1):
        for j in range(p,r-1,-1):
            i=j+k-p;denom=knots[i+p-r+1]-knots[i];a=(t-knots[i])/denom if denom else 0
            d[j]=[(1-a)*v+a*w for v,w in zip(d[j-1],d[j])]
    return d[p]

def value(c,t):return c[0]+t*(c[1]+t*c[2])
def derivative(c,t):return c[1]+2*c[2]*t

@lru_cache(maxsize=1)
def boundary():
    curves=json.loads((Path(__file__).parent/'data/s_boundary.json').read_text(encoding='utf-8'))['curves']
    spans=[]
    for c in curves:
        knots=sorted(set(c['knots']))
        for a,b in zip(knots,knots[1:]):
            points=[point(c,t) for t in (a,(a+b)/2,b)]
            coeff=[]
            for dim in (0,2):
                v,m,w=(pt[dim] for pt in points);q=2*(w+v-2*m);coeff.append((v,w-v-q,q))
            spans.append(tuple(coeff))
    area=mx=mz=0
    for x,z in spans:
        for t,w in ((.5-math.sqrt(3/5)/2,5/18),(.5,4/9),(.5+math.sqrt(3/5)/2,5/18)):
            xx,zz=value(x,t),value(z,t);dx,dz=derivative(x,t),derivative(z,t)
            area+=w*(xx*dz-zz*dx)/2;mx+=w*xx*xx*dz/2;mz-=w*zz*zz*dx/2
    return tuple(spans),(mx/area,mz/area)

def s_contours(radius=40,height=75,wind=16):
    spans,center=boundary();dx=radius-center[0];dz=height/2-center[1];result=[]
    for layer in range(wind+1):
        level=height*layer/wind;hits=[]
        for x,z in spans:
            a,b,c=z[2],z[1],z[0]+dz-level
            if abs(a)<1e-11:
                roots=[] if abs(b)<1e-11 else [-c/b]
            else:
                disc=b*b-4*a*c
                roots=[] if disc<=1e-18 else [(-b-math.sqrt(disc))/(2*a),(-b+math.sqrt(disc))/(2*a)]
            for t in roots:
                # Half-open per-span interval avoids double-counting shared vertices.
                if -1e-10<=t<1-1e-10 and abs(derivative(z,t))>1e-9:hits.append(value(x,max(0,t))+dx)
        hits.sort()
        if len(hits)%2:raise ValueError('S boundary slice has unmatched intersections')
        for a,b in zip(hits[::2],hits[1::2]):
            if b-a>1e-9:result.append(Contour((a,0,level),(b,0,level),layer))
    return tuple(result)
