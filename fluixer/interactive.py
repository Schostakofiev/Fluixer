"""Editable open 3D centerline with cubic interpolation."""
import math
from .geometry import finite
from .cubic import CubicSpan, CubicPath

def validate_points(value):
    if not isinstance(value, (list, tuple)) or not 3 <= len(value) <= 129:
        raise ValueError('Interactive curve requires 3-129 points')
    points = []
    for p in value:
        if not isinstance(p, (list, tuple)) or len(p) != 3:
            raise ValueError('Interactive points must be 3D coordinates')
        q = tuple(finite(v, 'coordinate') for v in p)
        if any(abs(v) > 10000 for v in q):
            raise ValueError('Interactive coordinate is out of range')
        points.append(q)
    if any(math.dist(a,b) < .01 for a,b in zip(points,points[1:])):
        raise ValueError('Interactive points are too close together')
    if math.dist(points[0],points[-1]) < .01:
        raise ValueError('Interactive curve must remain open')
    return tuple(points)

def interactive_path(points):
    points = validate_points(points)
    pieces = []
    for i, (a,b) in enumerate(zip(points,points[1:])):
        prev, after = points[max(0,i-1)], points[min(len(points)-1,i+2)]
        m = tuple((b[k]-prev[k])/2 if i else b[k]-a[k] for k in range(3))
        n = tuple((after[k]-a[k])/2 if i<len(points)-2 else b[k]-a[k] for k in range(3))
        pieces.append(CubicSpan(tuple((a[k],m[k],3*(b[k]-a[k])-2*m[k]-n[k],2*(a[k]-b[k])+m[k]+n[k]) for k in range(3))))
    return CubicPath(tuple(pieces),tuple(range(1,len(points))))


def segment_distance(a,b,c,d):
    sub=lambda a,b:tuple(x-y for x,y in zip(a,b))
    dot=lambda a,b:sum(x*y for x,y in zip(a,b))
    mix=lambda a,b,t:tuple(x+(y-x)*t for x,y in zip(a,b))
    clamp=lambda t:max(0.,min(1.,t))
    u,v,w=sub(b,a),sub(d,c),sub(a,c)
    aa,bb,cc,dd,ee=dot(u,u),dot(u,v),dot(v,v),dot(u,w),dot(v,w)
    if aa<1e-20:return math.dist(a,mix(c,d,clamp(ee/cc) if cc else 0))
    if cc<1e-20:return math.dist(mix(a,b,clamp(-dd/aa)),c)
    den=aa*cc-bb*bb
    s=clamp((bb*ee-cc*dd)/den) if den>1e-20 else 0
    t=(bb*s+ee)/cc
    if t<0:t,s=0,clamp(-dd/aa)
    elif t>1:t,s=1,clamp((bb-dd)/aa)
    return math.dist(mix(a,b,s),mix(c,d,t))


def check_constraints(path,diameter,target_length=None,avoid_collisions=True):
    if target_length is not None and abs(path.length-target_length)>max(1e-5,target_length*1e-7):
        raise ValueError('Interactive curve no longer matches its locked length')
    if not avoid_collisions:return
    # Capsule contact tolerance matches the browser solver. Curvature is not a
    # collision constraint; only non-neighbouring tube portions are obstacles.
    tolerance=min(.02,diameter*.002)
    segments=[]
    along=0.
    mix=lambda a,b:tuple((x+y)/2 for x,y in zip(a,b))
    def flatten(piece,bez,t0,t1,depth=0):
        nonlocal along
        a,b,e,d=bez
        flat=max(segment_distance(b,b,a,d),segment_distance(e,e,a,d))
        if flat>tolerance or math.dist(d,a)>diameter*.5:
            if depth>=16 or len(segments)>=4096:
                raise ValueError('Interactive collision check is too complex')
            ab,be,ed=mix(a,b),mix(b,e),mix(e,d)
            left,right=mix(ab,be),mix(be,ed)
            mid,tm=mix(left,right),(t0+t1)/2
            flatten(piece,(a,ab,left,mid),t0,tm,depth+1)
            flatten(piece,(mid,right,ed,d),tm,t1,depth+1)
            return
        end=along+math.dist(d,a)
        segments.append((a,d,along,end));along=end
    for piece in path.pieces:
        a,b=piece.point_at(0),piece.point_at(1)
        m,n=piece.derivative(0),piece.derivative(1)
        flatten(piece,(a,tuple(v+m[k]/3 for k,v in enumerate(a)),tuple(v-n[k]/3 for k,v in enumerate(b)),b),0,1)
    gap=math.pi*diameter/2
    clearance=diameter-tolerance
    boxes=[(tuple(min(a[k],b[k]) for k in range(3)),tuple(max(a[k],b[k]) for k in range(3)),i)
           for i,(a,b,_,_) in enumerate(segments)]
    axis=max(range(3),key=lambda k:max(box[1][k] for box in boxes)-min(box[0][k] for box in boxes))
    boxes.sort(key=lambda box:box[0][axis])
    for i,(lo,hi,index) in enumerate(boxes):
        for j in range(i+1,len(boxes)):
            other_lo,other_hi,other_index=boxes[j]
            if other_lo[axis]-hi[axis]>clearance:break
            first,last=sorted((index,other_index))
            a,b,_,end=segments[first]
            c,d,other_start,_=segments[last]
            if other_start-end<gap:continue
            if any(lo[k]-other_hi[k]>clearance or other_lo[k]-hi[k]>clearance for k in range(3)):continue
            if segment_distance(a,b,c,d)<clearance:
                raise ValueError('Interactive tube overlaps itself at this outer diameter')
