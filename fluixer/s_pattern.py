"""Planar S boundary decoded from GH object 71; exact linear/quadratic spans."""
import bisect,json,math
from functools import lru_cache
from pathlib import Path


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
