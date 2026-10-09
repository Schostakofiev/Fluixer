"""Restricted, non-executing SVG importer for closed filled geometry.

No browser DOM, external resources, CSS engine, or XML entities are evaluated.
Curves are flattened in viewBox-normalized coordinates before topology checks.
"""
import math,re,xml.etree.ElementTree as ET
from functools import lru_cache
from .pattern import Contour
from .svg_normalize import normalize

MAX_BYTES=131072
MAX_POINTS=4096
TOL=1e-5
NUM=r'[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?'
TOKEN=re.compile(NUM+r'|[a-zA-Z]')
IDENTITY=(1,0,0,1,0,0)

def number(value):
    if not isinstance(value,(str,int,float)) or isinstance(value,bool):raise ValueError('Invalid SVG number')
    if isinstance(value,str) and not re.fullmatch(NUM,value.strip()):raise ValueError('SVG coordinates must be numbers without percentages or units')
    n=float(value)
    if not math.isfinite(n) or abs(n)>1e8:raise ValueError('SVG coordinates are out of range')
    return n

def numbers(text):
    parts=re.findall(NUM,text)
    if re.sub(NUM,'',text).strip(' ,\t\r\n'):raise ValueError('Invalid SVG number list')
    return [number(p) for p in parts]

def multiply(a,b):
    aa,ab,ac,ad,ae,af=a;ba,bb,bc,bd,be,bf=b
    return (aa*ba+ac*bb,ab*ba+ad*bb,aa*bc+ac*bd,ab*bc+ad*bd,aa*be+ac*bf+ae,ab*be+ad*bf+af)

def apply(m,p):return (m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5])

def transform(text):
    m=IDENTITY;pos=0
    for match in re.finditer(r'([A-Za-z]+)\s*\(([^()]*)\)',text):
        if text[pos:match.start()].strip(' ,\t\n\r'):raise ValueError('Invalid SVG transform syntax')
        name=match[1];v=numbers(match[2]);pos=match.end()
        if name=='matrix' and len(v)==6:t=tuple(v)
        elif name=='translate' and len(v) in (1,2):t=(1,0,0,1,v[0],v[1] if len(v)==2 else 0)
        elif name=='scale' and len(v) in (1,2):t=(v[0],0,0,v[-1],0,0)
        elif name=='rotate' and len(v) in (1,3):
            a=math.radians(v[0]);t=(math.cos(a),math.sin(a),-math.sin(a),math.cos(a),0,0)
            if len(v)==3:t=multiply(multiply((1,0,0,1,v[1],v[2]),t),(1,0,0,1,-v[1],-v[2]))
        elif name in ('skewX','skewY') and len(v)==1:
            k=math.tan(math.radians(v[0]));t=(1,0,k,1,0,0) if name=='skewX' else (1,k,0,1,0,0)
        else:raise ValueError('Unsupported or invalid SVG transform: '+name)
        m=multiply(m,t)
    if text[pos:].strip(' ,\t\r\n'):raise ValueError('Invalid SVG transform syntax')
    if not all(math.isfinite(v) and abs(v)<=1e12 for v in m) or abs(m[0]*m[3]-m[1]*m[2])<1e-15:raise ValueError('SVG transform is degenerate or out of range')
    return m

def flat(points,out,depth=0):
    a,b=points[0],points[-1];dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
    # Distance to the finite chord also detects collinear reversals.
    def distance(p):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(length*length))) if length else 0
        return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
    if max(distance(p) for p in points)<=TOL:
        out.append(b)
        if len(out)>MAX_POINTS:raise ValueError('SVG outline is too complex. Simplify the path')
        return
    if depth>=18:raise ValueError('SVG curve cannot meet tessellation tolerance. Simplify it first')
    row=list(points);left=[row[0]];right=[row[-1]]
    while len(row)>1:
        row=[((a[0]+b[0])/2,(a[1]+b[1])/2) for a,b in zip(row,row[1:])];left.append(row[0]);right.append(row[-1])
    flat(left,out,depth+1);flat(right[::-1],out,depth+1)

def arc_points(start,v,end,m,out):
    rx,ry,rotation,large,sweep= v[:5]
    if rx<0 or ry<0 or large not in (0,1) or sweep not in (0,1):raise ValueError('Invalid SVG arc radius or flags')
    if start==end:return
    if rx==0 or ry==0:out.append(apply(m,end));return
    phi=math.radians(rotation);cs,sn=math.cos(phi),math.sin(phi)
    dx,dy=(start[0]-end[0])/2,(start[1]-end[1])/2;xp,yp=cs*dx+sn*dy,-sn*dx+cs*dy
    scale=xp*xp/(rx*rx)+yp*yp/(ry*ry)
    if scale>1:rx*=math.sqrt(scale);ry*=math.sqrt(scale)
    factor=math.sqrt(max(0,(rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)/(rx*rx*yp*yp+ry*ry*xp*xp)))
    if large==sweep:factor=-factor
    cxp,cyp=factor*rx*yp/ry,-factor*ry*xp/rx
    cx,cy=cs*cxp-sn*cyp+(start[0]+end[0])/2,sn*cxp+cs*cyp+(start[1]+end[1])/2
    u=((xp-cxp)/rx,(yp-cyp)/ry);w=((-xp-cxp)/rx,(-yp-cyp)/ry)
    begin=math.atan2(u[1],u[0]);delta=math.atan2(u[0]*w[1]-u[1]*w[0],u[0]*w[0]+u[1]*w[1])
    if not sweep and delta>0:delta-=2*math.pi
    if sweep and delta<0:delta+=2*math.pi
    # Bound the transformed ellipse's second derivative to control chord error.
    bound=math.hypot(m[0],m[1])*rx+math.hypot(m[2],m[3])*ry
    bound=max(bound,(rx+ry)*math.sqrt(sum(x*x for x in m[:4])))
    count=max(1,math.ceil(abs(delta)*math.sqrt(bound/(8*TOL))))
    if count+len(out)>MAX_POINTS:raise ValueError('SVG arc is too complex. Simplify it first')
    for i in range(1,count+1):
        a=begin+delta*i/count;out.append(apply(m,(cx+cs*rx*math.cos(a)-sn*ry*math.sin(a),cy+sn*rx*math.cos(a)+cs*ry*math.sin(a))))
    out[-1]=apply(m,end)

def path_rings(text,m):
    tokens=TOKEN.findall(text)
    if TOKEN.sub('',text).strip(' ,\t\r\n') or len(tokens)>16000:raise ValueError('SVG path syntax is invalid or too complex')
    rings=[];ring=None;pos=(0,0);start=None;prev=None;control=None;cmd=None;i=0
    counts={'M':2,'L':2,'H':1,'V':1,'C':6,'S':4,'Q':4,'T':2,'A':7}
    while i<len(tokens):
        if tokens[i].isalpha():cmd=tokens[i];i+=1
        if cmd is None:raise ValueError('SVG path command is missing')
        upper=cmd.upper();relative=cmd.islower()
        if upper=='Z':
            if ring is None:raise ValueError('SVG path has no starting point before closing')
            rings.append(ring);ring=None;pos=start;prev='Z';control=None;cmd=None;continue
        if upper not in counts:raise ValueError('Unsupported SVG path command: '+upper)
        n=counts[upper]
        if i+n>len(tokens) or any(t.isalpha() for t in tokens[i:i+n]):raise ValueError('Incomplete SVG path command parameters')
        v=[number(t) for t in tokens[i:i+n]];i+=n
        def pt(a,b):return (a+pos[0],b+pos[1]) if relative else (a,b)
        if upper=='M':
            if ring is not None:raise ValueError('SVG contains open subpaths. Close them before importing')
            pos=pt(*v);start=pos;ring=[apply(m,pos)];cmd='l' if relative else 'L'
        else:
            if ring is None:raise ValueError('SVG paths must start with M and close with Z')
            if upper in ('L','H','V'):
                end=pt(*v) if upper=='L' else ((v[0]+pos[0] if relative else v[0],pos[1]) if upper=='H' else (pos[0],v[0]+pos[1] if relative else v[0]))
                ring.append(apply(m,end));control=None
            elif upper in ('C','S','Q','T'):
                reflected=(2*pos[0]-control[0],2*pos[1]-control[1]) if control and ((upper=='S' and prev in ('C','S')) or (upper=='T' and prev in ('Q','T'))) else pos
                if upper=='C':p1,p2,end=pt(*v[:2]),pt(*v[2:4]),pt(*v[4:]);pts=[pos,p1,p2,end];control=p2
                elif upper=='S':p2,end=pt(*v[:2]),pt(*v[2:]);pts=[pos,reflected,p2,end];control=p2
                elif upper=='Q':p1,end=pt(*v[:2]),pt(*v[2:]);pts=[pos,p1,end];control=p1
                else:end=pt(*v);pts=[pos,reflected,end];control=reflected
                flat([apply(m,p) for p in pts],ring)
            else:
                end=pt(*v[5:]);arc_points(pos,v,end,m,ring);control=None
            pos=end
        prev=upper
        if len(ring or [])>MAX_POINTS:raise ValueError('SVG path is too complex')
    if ring is not None:raise ValueError('SVG contains open paths. Close them with Z')
    return rings

def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def intersects(a,b,c,d):
    if max(a[0],b[0])+1e-12<min(c[0],d[0]) or max(c[0],d[0])+1e-12<min(a[0],b[0]) or max(a[1],b[1])+1e-12<min(c[1],d[1]) or max(c[1],d[1])+1e-12<min(a[1],b[1]):return False
    p,q,r,s=cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)
    return p*q<=1e-24 and r*s<=1e-24

def validate_rings(groups):
    total=0
    for _,rings in groups:
        for ring in rings:
            while len(ring)>1 and math.dist(ring[0],ring[-1])<1e-12:ring.pop()
            total+=len(ring)
            if total>MAX_POINTS:raise ValueError('SVG exceeds 4096 tessellated points. Simplify it first')
            if len(ring)<3:raise ValueError('SVG outline must contain at least three points')
            if any(not math.isfinite(v) or v< -1e-8 or v>1+1e-8 for p in ring for v in p):raise ValueError('SVG pattern exceeds its viewBox. Adjust the artboard')
            edges=list(zip(ring,ring[1:]+ring[:1]))
            if any(math.dist(a,b)<1e-12 for a,b in edges):raise ValueError('SVG contains duplicate vertices or zero-length edges')
            for i,(a,b) in enumerate(edges):
                for j in range(i+1,len(edges)):
                    if j==i+1 or (i==0 and j==len(edges)-1):continue
                    if intersects(a,b,*edges[j]):raise ValueError('SVG outline intersects or touches itself. Clean up the path')
            if abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in edges))<1e-12:raise ValueError('SVG outline has zero area')
        # Nested subpaths are allowed; touching/crossing subpaths are ambiguous.
        for i,ring in enumerate(rings):
            for other in rings[i+1:]:
                if any(intersects(a,b,c,d) for a,b in zip(ring,ring[1:]+ring[:1]) for c,d in zip(other,other[1:]+other[:1])):raise ValueError('Subpaths intersect or overlap. Merge and clean them first')
    return total

@lru_cache(maxsize=8)
def parse_svg(source):
    if not isinstance(source,str) or len(source.encode('utf-8'))>MAX_BYTES:raise ValueError('SVG files must be smaller than 128 KB')
    if '\ufffd' in source:raise ValueError('Use UTF-8 encoding for SVG')
    encoding=re.search(r'<\?xml[^>]*encoding=[\"\']([^\"\']+)',source,re.I)
    if encoding and encoding[1].lower() not in ('utf-8','utf8'):raise ValueError('Use UTF-8 encoding for SVG')
    if re.search(r'<!\s*(DOCTYPE|ENTITY)|<\?(?!xml\s)',source,re.I):raise ValueError('SVG DOCTYPE, entities and external processing instructions are not supported')
    try:root=ET.fromstring(source)
    except ET.ParseError as e:raise ValueError('Invalid SVG XML syntax: '+str(e)) from e
    if root.tag not in ('svg','{http://www.w3.org/2000/svg}svg'):raise ValueError('The root element must be svg')
    root,conversion_notes=normalize(root)
    box=numbers(root.get('viewBox',''))
    if len(box)!=4 or box[2]<=0 or box[3]<=0:raise ValueError('SVG requires a valid viewBox="x y width height"')
    if len(list(root.iter()))>256:raise ValueError('Too many SVG elements. Simplify the file')
    norm=(1/box[2],0,0,-1/box[3],-box[0]/box[2],1+box[1]/box[3])
    groups=[]
    common={'id','transform','fill','fill-rule','stroke','stroke-width','stroke-linejoin','stroke-linecap','stroke-miterlimit','opacity','fill-opacity','stroke-opacity','style'}
    geometries={'path':{'d','pathLength'},'polygon':{'points'},'rect':{'x','y','width','height','rx','ry'},'circle':{'cx','cy','r'},'ellipse':{'cx','cy','rx','ry'},'g':set(),'svg':{'viewBox','width','height','version','preserveAspectRatio'}}
    def walk(node,parent,style,depth=0):
        if depth>20:raise ValueError('SVG groups are nested too deeply')
        if node.tag.startswith('{') and not node.tag.startswith('{http://www.w3.org/2000/svg}'):raise ValueError('Unsupported SVG namespace element')
        tag=node.tag.split('}')[-1]
        if tag in ('title','desc'):
            if list(node):raise ValueError('SVG description elements cannot contain shapes')
            return
        if tag not in geometries:raise ValueError('Unsupported SVG element <'+tag+'>: outline text and strokes; remove images, references and effects')
        if tag=='svg' and node is not root:raise ValueError('Nested SVG artboards are not supported')
        for key in node.attrib:
            # Editor metadata has no rendering semantics and is never evaluated.
            if re.fullmatch(r'data-[a-zA-Z0-9_.-]+',key):continue
            if key not in common|geometries[tag]:raise ValueError('Unsupported SVG attribute: '+key)
        local=dict(style)
        for k in ('fill','fill-rule','stroke','opacity','fill-opacity','stroke-opacity'):
            if k in node.attrib:local[k]=node.attrib[k]
        for decl in node.get('style','').split(';'):
            if not decl.strip():continue
            if ':' not in decl:raise ValueError('Invalid SVG style syntax')
            k,v=[x.strip() for x in decl.split(':',1)]
            if k not in ('fill','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','opacity','fill-opacity','stroke-opacity'):raise ValueError('Unsupported SVG style: '+k)
            local[k]=v
        for k in ('opacity','fill-opacity','stroke-opacity'):
            if k in local and number(local[k])!=1:raise ValueError('SVG transparency is not supported. Use opaque filled outlines')
        if local.get('fill-rule','nonzero') not in ('evenodd','nonzero'):raise ValueError('Invalid SVG fill rule')
        m=multiply(parent,transform(node.get('transform','')))
        if tag in ('g','svg'):
            for child in node:walk(child,m,local,depth+1)
            return
        if list(node):raise ValueError('Child elements inside SVG shapes are not supported')
        fill=local.get('fill','black').strip();stroke=local.get('stroke','none').strip()
        if fill.lower()=='none' or stroke.lower()!='none':raise ValueError('SVG must use filled outlines without strokes. Expand strokes first')
        basic_colors={'black','silver','gray','white','maroon','red','purple','fuchsia','green','lime','olive','yellow','navy','blue','teal','aqua','orange'}
        rgb=re.fullmatch(r'rgb\(\s*('+NUM+r'%?)\s*,\s*('+NUM+r'%?)\s*,\s*('+NUM+r'%?)\s*\)',fill)
        rgb_ok=bool(rgb) and len({v.endswith('%') for v in rgb.groups()})==1 and all(0<=float(v.rstrip('%'))<=(100 if v.endswith('%') else 255) for v in rgb.groups())
        if not (re.fullmatch(r'#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?',fill) or fill.lower() in basic_colors or rgb_ok):raise ValueError('Use opaque #RGB, #RRGGBB, rgb() or basic color names; gradients and transparent colors are not supported')
        def n(name,default='0'):return number(node.get(name,default))
        if tag=='path':rings=path_rings(node.get('d',''),m)
        elif tag=='polygon':
            v=numbers(node.get('points',''))
            if len(v)%2:raise ValueError('Invalid polygon coordinate count')
            rings=[[apply(m,(v[i],v[i+1])) for i in range(0,len(v),2)]]
        elif tag=='rect':
            x,y,w,h=n('x'),n('y'),n('width'),n('height')
            if w<=0 or h<=0:raise ValueError('SVG rectangle width and height must be positive')
            if n('rx') or n('ry'):raise ValueError('Convert rounded rectangles to paths first')
            rings=[[apply(m,p) for p in ((x,y),(x+w,y),(x+w,y+h),(x,y+h))]]
        else:
            cx,cy=n('cx'),n('cy');rx=n('r') if tag=='circle' else n('rx');ry=rx if tag=='circle' else n('ry')
            if rx<=0 or ry<=0:raise ValueError('SVG circle and ellipse radii must be positive')
            start=(cx+rx,cy);ring=[apply(m,start)]
            arc_points(start,[rx,ry,0,0,1],(cx-rx,cy),m,ring);arc_points((cx-rx,cy),[rx,ry,0,0,1],start,m,ring);rings=[ring]
        if not rings:raise ValueError('SVG contains an empty path')
        groups.append((local.get('fill-rule','nonzero'),rings))
        if sum(len(r) for _,rs in groups for r in rs)>MAX_POINTS:raise ValueError('SVG exceeds 4096 tessellated points. Simplify it first')
    walk(root,norm,{})
    if not groups:raise ValueError('SVG has no usable closed filled outlines')
    count=validate_rings(groups)
    immutable=tuple((rule,tuple(tuple(tuple(p) for p in ring) for ring in rings)) for rule,rings in groups)
    canonical=ET.Element('svg',{'xmlns':'http://www.w3.org/2000/svg','viewBox':f'0 0 {box[2]:.12g} {box[3]:.12g}'})
    for rule,rings in immutable:
        d=' '.join('M'+' L'.join(f'{x*box[2]:.12g} {(1-z)*box[3]:.12g}' for x,z in ring)+' Z' for ring in rings)
        ET.SubElement(canonical,'path',{'fill':'#000000','fill-rule':rule,'d':d})
    return {'normalized_svg':ET.tostring(canonical,encoding='unicode'),'conversion_notes':conversion_notes,'groups':immutable,'view_box':tuple(box),'point_count':count,'ring_count':sum(len(rings) for _,rings in groups),'tolerance':TOL}

def svg_contours(source,width,height,x,z,levels):
    return groups_contours(parse_svg(source)['groups'],width,height,x,z,levels)

def groups_contours(groups,width,height,x,z,levels):
    result=[]
    for layer,level in enumerate(levels):
        intervals=[]
        for rule,rings in groups:
            hits=[]
            for ring in rings:
                for a,b in zip(ring,ring[1:]+ring[:1]):
                    ax,az=x+a[0]*width,z+a[1]*height;bx,bz=x+b[0]*width,z+b[1]*height
                    if min(az,bz)<=level<max(az,bz):hits.append((ax+(level-az)*(bx-ax)/(bz-az),1 if bz>az else -1))
            hits.sort();winding=0;previous=None
            for position,delta in hits:
                if previous is not None and (winding%2 if rule=='evenodd' else winding!=0) and position>previous:intervals.append((previous,position))
                winding+=delta;previous=position
            if winding:raise ValueError('SVG slice is not closed')
        merged=[]
        for a,b in sorted(intervals):
            if merged and a<=merged[-1][1]+1e-10:merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
            else:merged.append((a,b))
        for a,b in merged:result.append(Contour((a,0,level),(b,0,level),layer))
    return tuple(result)
