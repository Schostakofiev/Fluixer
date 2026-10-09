"""Polygon scanlines and contour-endpoint projection, in physical units.

Polygon rings use even/odd filling (including holes). This does not decode
Rhino Breps or recreate the GH compensation graph mapper.
"""
from dataclasses import dataclass
from .geometry import finite
from .segments import partition_path


@dataclass(frozen=True)
class Contour:
    start: tuple
    end: tuple
    layer: int = 0


def polygon_contours(rings, levels, *, y=0, offsets=None):
    """Slice XZ polygon rings; lower edges included, upper edges excluded.

    offsets supplies explicit X compensation per layer, before projection.
    Rings must be simple polygons; curves must first be explicitly polygonized.
    """
    y = finite(y, 'y')
    polygons = []
    for ring in rings:
        points = tuple((finite(x, 'x'), finite(z, 'z')) for x,z in ring)
        if len(points)>1 and points[0]==points[-1]: points=points[:-1]
        if len(set(points))<3: raise ValueError('ring needs three distinct vertices')
        polygons.append(points)
    levels = tuple(finite(z,'level') for z in levels)
    offsets = (0,)*len(levels) if offsets is None else tuple(finite(x,'offset') for x in offsets)
    if len(offsets)!=len(levels): raise ValueError('one offset required per layer')
    result=[]
    for layer,(z,offset) in enumerate(zip(levels,offsets)):
        hits=[]
        for ring in polygons:
            for (x0,z0),(x1,z1) in zip(ring,ring[1:]+ring[:1]):
                if min(z0,z1)<=z<max(z0,z1):
                    hits.append(x0+(z-z0)*(x1-x0)/(z1-z0)+offset)
        hits.sort()
        if len(hits)%2: raise ValueError('polygon scanline has unmatched intersections')
        for a,b in zip(hits[::2],hits[1::2]):
            if a<b: result.append(Contour((a,y,z),(b,y,z),layer))
    return tuple(result)


def project_contours(path, contours):
    """Return physical segments from paired nearest contour endpoints.

    This is GH's endpoint-projection workflow, not volume/path intersection.
    Endpoints may be off the path; pairing is retained before window union.
    """
    windows=[]
    for contour in contours:
        a=path.project(contour.start).distance_along
        b=path.project(contour.end).distance_along
        windows.append((min(a,b),max(a,b)))
    return partition_path(path,windows)
