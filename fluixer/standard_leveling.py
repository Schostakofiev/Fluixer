"""Standard vertical leveling stripe: one literal 100-step liquid move per row.

Only gas spacing and Pre-Add use the user's measured step length and gas factor.
Tube-height geometric compensation shifts the stripe; pattern plane, liquid
factor and output-unit settings do not participate.
"""
import csv
import io
import math
from .cubic import CubicSpan, unit_roots
from .geometry import Line, finite
from .pipeline import cylinder_settings, tube_path, path_bounds
from .compensation import curve_settings
from .path_partition import compensation_transform
from .export import HEADER, MachineParameters, build_rows

STANDARD_STEPS = 100


def row_centers(cylinder, curve=None):
    """Arc-length positions crossing the tube's central vertical stripe.

    A helix contributes only its front crossing; an S contributes every straight
    pass. Using real path lengths preserves bends and the cylinder's helical rise.
    """
    if cylinder.type not in ('cylinder', 's-curve'):
        raise ValueError('Standard leveling supports Cylinder Helix and S-Shape only')
    path=tube_path(cylinder)
    lo,hi=path_bounds(path)
    center_x=(lo[0]+hi[0])/2
    center_y=(lo[1]+hi[1])/2
    curve = curve if curve is not None else curve_settings(None)
    transform = compensation_transform((lo[2], hi[2]), curve)
    active = curve[0] != 0 and any(curve[2])
    centers=[];start=0.0
    for piece in path.pieces:
        if active and isinstance(piece, (CubicSpan, Line)):
            # Use the same tube-height displacement as ordinary pattern slicing.
            def value(t):
                return transform(piece.point_at(t))[0] - center_x
            candidates=[]
            a=0.;fa=value(a)
            span=abs(piece.point_at(1)[2]-piece.point_at(0)[2])
            count=max(16,math.ceil(span/max(hi[2]-lo[2],1e-12)*512))
            for j in range(1,count+1):
                b=j/count;fb=value(b)
                if abs(fa)<1e-10:candidates.append(a)
                if fa*fb<0:
                    left,right=a,b;fl=fa
                    for _ in range(40):
                        mid=(left+right)/2;fm=value(mid)
                        if fl*fm<=0:right=mid
                        else:left=mid;fl=fm
                    candidates.append((left+right)/2)
                if j==count and abs(fb)<1e-10:candidates.append(b)
                a,fa=b,fb
        elif isinstance(piece,CubicSpan):
            a,b,c,d=piece.coefficients[0]
            candidates=unit_roots((a-center_x,b,c,d))
        elif isinstance(piece,Line) and piece.end[0]!=piece.start[0]:
            t=(center_x-piece.start[0])/(piece.end[0]-piece.start[0])
            candidates=(t,) if 0<=t<=1 else ()
        else:
            candidates=()
        for t in candidates:
            p=piece.point_at(t)
            if cylinder.type=='cylinder' and p[1]>=center_y:continue
            distance=start+(piece.length_to(t) if isinstance(piece,CubicSpan) else piece.length*t)
            if not centers or distance-centers[-1]>1e-7:centers.append(distance)
        start+=piece.length
    expected=cylinder.wind*(2 if cylinder.type=='s-curve' else 1)
    if len(centers)!=expected:
        raise ValueError('Could not identify one standard segment for each tube row')
    return centers


def standard_rows(data):
    allowed={'cylinder','compensation','speed','k_gas','pre_add','length_per_100_steps'}
    if not isinstance(data,dict) or set(data)-allowed:raise ValueError('Unknown standard leveling parameters')
    def number(name,default):
        if isinstance(data.get(name),bool):raise ValueError(f'Invalid {name}')
        return finite(data.get(name,default),name)
    speed=number('speed',400);gas_k=number('k_gas',606)
    distance=number('length_per_100_steps',9.65);pre_add=number('pre_add',730)
    if speed<0 or gas_k<0 or distance<=0 or not 0<=pre_add<=10000:
        raise ValueError('Invalid gas spacing or machine parameters')
    centers=row_centers(cylinder_settings(data.get('cylinder')),curve_settings(data.get('compensation')))
    divisor=distance/100
    if divisor==0:raise ValueError('Gas spacing conversion underflow')
    machine=MachineParameters(speed,gas_k,625)
    # The 100 and 50 below are literal liquid command budgets, not lengths
    # converted back into liquid steps. Step length is used only on the gas side.
    gaps=[(b-a)/divisor-STANDARD_STEPS for a,b in zip(centers,centers[1:])]
    tail=(centers[0]+pre_add)/divisor-STANDARD_STEPS/2
    if any(not math.isfinite(v) or v<=0 for v in gaps) or not math.isfinite(tail) or tail<0:
        raise ValueError('The current gas calibration leaves insufficient space for 100-step segments. Increase the tube size or check 100 Steps Length')
    rows=[]
    for i in range(len(centers)-1,-1,-1):
        # Exact liquid command, independent of k_Liquid and Steps/Segments.
        rows.append(['move','l','fwd',STANDARD_STEPS,int(speed),'steps',''])
        gas=gaps[i-1] if i else tail
        if gas>0:rows.extend(build_rows([gas],[0],machine,'steps'))
        if len(rows)>1_000_000:raise ValueError('Standard export exceeds one million rows')
    return rows,len(centers)


def standard_csv_payload(data):
    rows,count=standard_rows(data)
    stream=io.StringIO(newline='');writer=csv.writer(stream)
    writer.writerow(HEADER);writer.writerows(rows)
    return stream.getvalue().encode('utf-8-sig'),'fluixer_standard_100steps.csv',len(rows),count
