"""Portable line/semicircle S-path, inferred from GH #4..#27/#197.

Coordinates use the caller's model length unit. Distance evaluation is true arc
length, deliberately distinct from Rhino curve parameters. This candidate is
not installed into GH and is not a replacement for the interpolated cylinder.
"""
from bisect import bisect_right
from dataclasses import dataclass, field
import math

Point = tuple[float, float, float]


def finite(value, name):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(name + ' must be finite')
    return value


@dataclass(frozen=True)
class Line:
    start: Point
    end: Point

    @property
    def length(self):
        return math.dist(self.start, self.end)

    def point_at(self, fraction):
        return tuple(a + (b-a)*fraction for a,b in zip(self.start,self.end))

    def project(self, point):
        delta = tuple(b-a for a,b in zip(self.start,self.end))
        t = sum((p-a)*d for p,a,d in zip(point,self.start,delta)) / self.length**2
        t = min(1.0, max(0.0, t))
        q = self.point_at(t)
        return t, q, math.dist(point,q)


@dataclass(frozen=True)
class UpwardSemicircle:
    """XZ semicircle from bottom to top, bulging right (+1) or left (-1)."""
    center: Point
    radius: float
    side: int

    @property
    def length(self):
        return math.pi*self.radius

    def point_at(self, fraction):
        x,y,z = self.center
        if fraction == 0:
            return (x,y,z-self.radius)
        if fraction == 1:
            return (x,y,z+self.radius)
        angle = math.pi*fraction
        return (x+self.side*self.radius*math.sin(angle),y,z-self.radius*math.cos(angle))

    def project(self, point):
        px = self.side*(point[0]-self.center[0])
        pz = point[2]-self.center[2]
        candidates = [0.0, 1.0]
        angle = math.atan2(px, -pz)
        if 0 <= angle <= math.pi:
            candidates.append(angle/math.pi)
        result = [(t,self.point_at(t),math.dist(point,self.point_at(t))) for t in candidates]
        return min(result,key=lambda item:(item[2],item[0]))


@dataclass(frozen=True)
class CircularArc:
    """XZ circular arc with signed sweep and true arc-length parameterization."""
    center: Point
    radius: float
    start_angle: float
    sweep: float

    @property
    def length(self):
        return abs(self.sweep)*self.radius

    def point_at(self, fraction):
        angle = self.start_angle+self.sweep*fraction
        x,y,z = self.center
        return (x+self.radius*math.cos(angle),y,z+self.radius*math.sin(angle))

    def project(self, point):
        angle = math.atan2(point[2]-self.center[2],point[0]-self.center[0])
        candidates = [0.0,1.0]
        for turn in range(-2,3):
            t = (angle+turn*2*math.pi-self.start_angle)/self.sweep
            if 0 <= t <= 1: candidates.append(t)
        return min(((t,self.point_at(t),math.dist(point,self.point_at(t))) for t in candidates),key=lambda v:(v[2],v[0]))


def rounded_orthogonal_path(points, radius, length_unit='mm'):
    pieces, previous = [], points[0]
    for a,b,c in zip(points,points[1:],points[2:]):
        incoming = tuple((v-u)/math.dist(a,b) for u,v in zip(a,b))
        outgoing = tuple((v-u)/math.dist(b,c) for u,v in zip(b,c))
        cross = incoming[0]*outgoing[2]-incoming[2]*outgoing[0]
        if abs(cross) < .5:
            pieces.append(Line(previous,b));previous=b;continue
        entry = tuple(v-radius*d for v,d in zip(b,incoming))
        end = tuple(v+radius*d for v,d in zip(b,outgoing))
        center = tuple(v+radius*d for v,d in zip(entry,outgoing))
        if math.dist(previous,entry)>1e-10:pieces.append(Line(previous,entry))
        pieces.append(CircularArc(center,radius,math.atan2(entry[2]-center[2],entry[0]-center[0]),math.copysign(math.pi/2,cross)))
        previous=end
    pieces.append(Line(previous,points[-1]))
    return TubePath(tuple(pieces),length_unit)


@dataclass(frozen=True)
class PathProjection:
    distance_along: float
    point: Point
    distance_to_path: float


@dataclass(frozen=True)
class TubePath:
    pieces: tuple[Line | UpwardSemicircle | CircularArc, ...]
    length_unit: str
    _ends: tuple[float, ...] = field(init=False, repr=False)

    def __post_init__(self):
        if not self.pieces or not self.length_unit:
            raise ValueError('path requires pieces and an explicit length unit')
        ends, total = [], 0.0
        for i,piece in enumerate(self.pieces):
            if not math.isfinite(piece.length) or piece.length <= 0:
                raise ValueError('path pieces must have positive finite lengths')
            if isinstance(piece, UpwardSemicircle) and piece.side not in (-1,1):
                raise ValueError('arc side must be -1 or 1')
            if not all(math.isfinite(v) for t in (0,1) for v in piece.point_at(t)):
                raise ValueError('path coordinates must be finite')
            if i and math.dist(self.pieces[i-1].point_at(1),piece.point_at(0)) > 1e-9:
                raise ValueError('path pieces must be continuous')
            total += piece.length
            ends.append(total)
        if not math.isfinite(total):
            raise ValueError('path length overflow')
        object.__setattr__(self,'_ends',tuple(ends))

    @property
    def length(self):
        return self._ends[-1]

    def point_at_distance(self, distance):
        distance = finite(distance,'distance')
        if not 0 <= distance <= self.length:
            raise ValueError('distance is outside path')
        if distance == self.length:
            return self.pieces[-1].point_at(1)
        i = bisect_right(self._ends,distance)
        start = self._ends[i-1] if i else 0.0
        return self.pieces[i].point_at((distance-start)/self.pieces[i].length)

    def project(self, point):
        point = tuple(finite(p,'point coordinate') for p in point)
        if len(point) != 3:
            raise ValueError('point must have three coordinates')
        results = []
        start = 0.0
        for piece in self.pieces:
            t,q,distance = piece.project(point)
            results.append(PathProjection(start+t*piece.length,q,distance))
            start += piece.length
        return min(results,key=lambda p:(p.distance_to_path,p.distance_along))


def s_curve(width=100, height=80, wind=16, *, length_unit='mm'):
    """GH-style candidate: 2*wind lines and 2*wind half-circles.

    Height is the GH slider value, not final bounding-box height. The GH x*2
    array spacing produces final height 2*height and spacing height/wind.
    """
    width, height = finite(width,'width'), finite(height,'height')
    turns = finite(wind,'wind')
    if width <= 0 or height <= 0 or turns < 1 or turns != int(turns) or turns > 10000:
        raise ValueError('width/height must be positive; wind must be an integer 1..10000')
    turns = int(turns)
    gap = height/turns
    pieces = []
    for row in range(2*turns):
        z = row*gap
        if row % 2 == 0:
            pieces.append(Line((0,0,z),(width,0,z)))
            pieces.append(UpwardSemicircle((width,0,z+gap/2),gap/2,1))
        else:
            pieces.append(Line((width,0,z),(0,0,z)))
            pieces.append(UpwardSemicircle((0,0,z+gap/2),gap/2,-1))
    return TubePath(tuple(pieces),length_unit)


def hilbert_curve(width=80, height=75, order=3, *, rounded=True, length_unit='mm'):
    """Continuous Hilbert polyline in XZ; independent rectangular scaling."""
    width, height, order = finite(width,'width'), finite(height,'height'), finite(order,'order')
    if width <= 0 or height <= 0 or order != int(order) or not 1 <= order <= 6:
        raise ValueError('width/height must be positive; order must be an integer 1..6')
    size = 2**int(order)
    points = []
    for distance in range(size*size):
        x = z = 0
        t, scale = distance, 1
        while scale < size:
            rx, rz = (t//2)&1, (t^(t//2))&1
            if rz == 0:
                if rx == 1: x,z = scale-1-x,scale-1-z
                x,z = z,x
            x,z = x+scale*rx,z+scale*rz
            t //= 4
            scale *= 2
        points.append((x*width/(size-1),0,z*height/(size-1)))
    if rounded:return rounded_orthogonal_path(points,min(width,height)/(size-1)/4,length_unit)
    return TubePath(tuple(Line(a,b) for a,b in zip(points,points[1:])),length_unit)
