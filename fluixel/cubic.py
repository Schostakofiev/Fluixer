"""Dependency-free cubic path candidate; arc length and parameter stay distinct."""
from bisect import bisect_right
from dataclasses import dataclass, field
import math
from .geometry import finite, PathProjection

# Five-point Gauss-Legendre integration; cylinder spans are short smooth cubics.
_NODES = (0, -.5384693101056831, .5384693101056831, -.9061798459386640, .9061798459386640)
_WEIGHTS = (.5688888888888889, .4786286704993665, .4786286704993665, .2369268850561891, .2369268850561891)


def polynomial_value(coefficients, x):
    value=0.0
    for coefficient in reversed(coefficients):
        value=value*x+coefficient
    return value


def unit_roots(coefficients):
    """Real polynomial roots on [0,1], isolated by derivative critical points.

    Used for cubic boundary crossings and quintic closest-point stationarity.
    Identically zero polynomials contribute endpoints (a coincident boundary).
    """
    c=list(coefficients)
    scale=max(map(abs,c),default=0)
    if scale == 0:
        return (0.0,1.0)
    c=[x/scale for x in c]
    while len(c)>1 and abs(c[-1])<1e-15:
        c.pop()
    if len(c)==1:
        return ()
    if len(c)==2:
        root=-c[0]/c[1]
        return (min(1.0,max(0.0,root)),) if -1e-13<=root<=1+1e-13 else ()
    critical=unit_roots([i*c[i] for i in range(1,len(c))])
    cuts=sorted(set((0.0,1.0)+critical))
    roots=[x for x in cuts if abs(polynomial_value(c,x))<1e-13]
    for left,right in zip(cuts,cuts[1:]):
        fl,fr=polynomial_value(c,left),polynomial_value(c,right)
        if fl*fr>=0:
            continue
        for _ in range(48):
            mid=(left+right)/2
            fm=polynomial_value(c,mid)
            if fl*fm<=0:
                right=mid
            else:
                left,fl=mid,fm
        roots.append((left+right)/2)
    result=[]
    for root in sorted(roots):
        if not result or root-result[-1]>1e-10:
            result.append(root)
    return tuple(result)


@dataclass(frozen=True)
class CubicSpan:
    # Ascending powers in local u, separately for x/y/z.
    coefficients: tuple[tuple[float,float,float,float], ...]
    _length: float = field(init=False,repr=False)

    def __post_init__(self):
        if len(self.coefficients)!=3 or any(len(c)!=4 for c in self.coefficients):
            raise ValueError('cubic span needs three coordinate polynomials')
        if not all(math.isfinite(x) for c in self.coefficients for x in c):
            raise ValueError('cubic coefficients must be finite')
        object.__setattr__(self,'_length',self.length_to(1.0))

    def point_at(self,u):
        return tuple(polynomial_value(c,u) for c in self.coefficients)

    def derivative(self,u):
        return tuple(c[1]+u*(2*c[2]+3*u*c[3]) for c in self.coefficients)

    def length_to(self,u):
        return u/2*sum(w*math.sqrt(sum(d*d for d in self.derivative(u/2*(n+1))))
                       for n,w in zip(_NODES,_WEIGHTS))

    @property
    def length(self):
        return self._length

    def lower_distance_bound(self,point):
        # A cubic lies inside its Bezier control hull, so its AABB is a lower bound.
        distance=0.0
        for p,(a,b,c,d) in zip(point,self.coefficients):
            values=(a,a+b/3,a+2*b/3+c/3,a+b+c+d)
            distance+=max(min(values)-p,0,p-max(values))**2
        return math.sqrt(distance)

    def project(self,point):
        polynomial=[0.0]*6
        for p,c in zip(point,self.coefficients):
            delta=[c[0]-p,*c[1:]]
            derivative=[c[1],2*c[2],3*c[3]]
            for i,a in enumerate(delta):
                for j,b in enumerate(derivative):
                    polynomial[i+j]+=a*b
        roots=(0.0,1.0)+unit_roots(polynomial)
        candidates=[(u,self.point_at(u),math.dist(point,self.point_at(u))) for u in roots]
        return min(candidates,key=lambda x:(x[2],x[0]))


@dataclass(frozen=True)
class CubicPath:
    pieces: tuple[CubicSpan,...]
    parameter_ends: tuple[float,...]
    length_unit: str = 'mm'
    _ends: tuple[float,...] = field(init=False,repr=False)

    def __post_init__(self):
        if not self.pieces or len(self.parameter_ends)!=len(self.pieces) or not self.length_unit:
            raise ValueError('invalid cubic path')
        total,previous=0.0,0.0
        ends=[]
        for i,(piece,t) in enumerate(zip(self.pieces,self.parameter_ends)):
            if not math.isfinite(t) or t<=previous or piece.length<=0:
                raise ValueError('degenerate cubic path')
            if i and math.dist(self.pieces[i-1].point_at(1),piece.point_at(0))>1e-8:
                raise ValueError('disconnected cubic pieces')
            total+=piece.length; ends.append(total); previous=t
        object.__setattr__(self,'_ends',tuple(ends))

    @property
    def length(self):
        return self._ends[-1]

    def point_at_parameter(self,t):
        t=finite(t,'parameter')
        if not 0<=t<=self.parameter_ends[-1]:
            raise ValueError('parameter outside path')
        i=min(len(self.pieces)-1,bisect_right(self.parameter_ends,t))
        start=self.parameter_ends[i-1] if i else 0
        return self.pieces[i].point_at((t-start)/(self.parameter_ends[i]-start))

    def point_at_distance(self,distance):
        distance=finite(distance,'distance')
        if not 0<=distance<=self.length:
            raise ValueError('distance outside path')
        if distance==self.length:
            return self.pieces[-1].point_at(1)
        i=bisect_right(self._ends,distance)
        local=distance-(self._ends[i-1] if i else 0)
        left,right=0.0,1.0
        piece=self.pieces[i]
        if local==0:return piece.point_at(0)
        mid=local/piece.length
        for _ in range(40):
            error=piece.length_to(mid)-local
            if abs(error)<=1e-11:return piece.point_at(mid)
            if error<0:left=mid
            else:right=mid
            speed=math.sqrt(sum(v*v for v in piece.derivative(mid)))
            candidate=mid-error/speed if speed>1e-14 else -1
            mid=candidate if left<candidate<right else (left+right)/2
        return piece.point_at((left+right)/2)

    def project(self,point):
        point=tuple(finite(v,'point') for v in point)
        if len(point)!=3:raise ValueError('point must have three coordinates')
        best=None
        for i,piece in enumerate(self.pieces):
            if best and piece.lower_distance_bound(point)>best.distance_to_path:
                continue
            u,q,d=piece.project(point)
            start=self._ends[i-1] if i else 0
            candidate=PathProjection(start+piece.length_to(u),q,d)
            if best is None or (d,candidate.distance_along)<(best.distance_to_path,best.distance_along):
                best=candidate
        return best


def interpolate_chord(points, *, z_scale=1.0):
    """Clamped cubic with unit endpoint tangents estimated from three points.

    Endpoint policy is inferred from this GH definition's saved control points;
    it is not a promise to emulate every Rhino interpolation option.
    """
    points=tuple(tuple(finite(v,'coordinate') for v in p) for p in points)
    z_scale=finite(z_scale,'z scale')
    if len(points)<3 or any(len(p)!=3 for p in points) or z_scale<=0:
        raise ValueError('requires at least three 3D points and positive scale')
    h=[math.dist(a,b) for a,b in zip(points,points[1:])]
    if min(h)<=0:raise ValueError('duplicate consecutive interpolation points')
    slopes=[tuple((b-a)/step for a,b in zip(p,q)) for p,q,step in zip(points,points[1:],h)]
    def unit(v):
        norm=math.sqrt(sum(x*x for x in v))
        if norm==0:raise ValueError('undefined endpoint tangent')
        return tuple(x/norm for x in v)
    start=unit(tuple(((2*h[0]+h[1])*a-h[0]*b)/(h[0]+h[1]) for a,b in zip(slopes[0],slopes[1])))
    end=unit(tuple(((2*h[-1]+h[-2])*a-h[-1]*b)/(h[-1]+h[-2]) for a,b in zip(slopes[-1],slopes[-2])))
    count=len(points)
    lower=[0.0]+h
    upper=h+[0.0]
    diag=[2*h[0]]+[2*(h[i-1]+h[i]) for i in range(1,count-1)]+[2*h[-1]]
    rhs=[list(6*(b-a) for a,b in zip(start,slopes[0]))]
    rhs += [list(6*(b-a) for a,b in zip(slopes[i-1],slopes[i])) for i in range(1,count-1)]
    rhs += [list(6*(b-a) for a,b in zip(slopes[-1],end))]
    for i in range(1,count):
        ratio=lower[i]/diag[i-1]
        diag[i]-=ratio*upper[i-1]
        rhs[i]=[b-ratio*a for a,b in zip(rhs[i-1],rhs[i])]
    second=[None]*count
    second[-1]=tuple(x/diag[-1] for x in rhs[-1])
    for i in range(count-2,-1,-1):
        second[i]=tuple((x-upper[i]*y)/diag[i] for x,y in zip(rhs[i],second[i+1]))
    spans,ends=[],[]
    t=0.0
    for i,step in enumerate(h):
        coefficients=[]
        for axis in range(3):
            m,n=second[i][axis],second[i+1][axis]
            scale=z_scale if axis==2 else 1
            coefficients.append(tuple(scale*x for x in (points[i][axis],
                slopes[i][axis]*step-step*step*(2*m+n)/6,
                m*step*step/2,(n-m)*step*step/6)))
        spans.append(CubicSpan(tuple(coefficients)))
        t+=step;ends.append(t)
    return CubicPath(tuple(spans),tuple(ends))


def cylinder_spiral(radius=40, diameter=4, height=75, wind=16, samples_per_turn=150,
                    *, period=1, length_unit='mm'):
    """Candidate for the saved GH Period=1, Index=0, cubic/chord configuration.

    Reconstruct each full clockwise turn, interpolate before Z scaling, then
    translate copies. Other GH Period/index/degree modes are not guessed.
    """
    radius,diameter,height=(finite(v,n) for v,n in ((radius,'radius'),(diameter,'diameter'),(height,'height')))
    wind,samples=finite(wind,'wind'),finite(samples_per_turn,'samples')
    if radius<=0 or diameter<0 or height<=0 or wind!=int(wind) or not 1<=wind<=1000:
        raise ValueError('invalid cylinder dimensions/wind')
    if samples!=int(samples) or not 8<=samples<=2000 or samples*wind>200000:
        raise ValueError('samples must be integer 8..2000; total spans <=200000')
    if period!=1:raise ValueError('only the verified Period=1 configuration is implemented')
    wind,samples=int(wind),int(samples)
    r=radius+diameter/2
    points=[(radius+r*math.cos(2*math.pi*i/samples),radius-r*math.sin(2*math.pi*i/samples),height*i/samples)
            for i in range(samples+1)]
    points[-1]=(radius+r,radius,height)
    turn=interpolate_chord(points,z_scale=1/wind)
    pieces,ends=[],[]
    for j in range(wind):
        for piece,t in zip(turn.pieces,turn.parameter_ends):
            c=list(piece.coefficients)
            c[2]=(c[2][0]+j*height/wind,*c[2][1:])
            pieces.append(CubicSpan(tuple(c)))
            ends.append(j*turn.parameter_ends[-1]+t)
    return CubicPath(tuple(pieces),tuple(ends),length_unit)
