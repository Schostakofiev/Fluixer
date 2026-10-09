"""Normalize editor SVG structure to the geometry importer's small vocabulary."""
import copy
import re
import xml.etree.ElementTree as ET

SVG='http://www.w3.org/2000/svg'
XLINK='{http://www.w3.org/1999/xlink}href'

def normalize(root):
    notes=[]
    def note(text):
        if text not in notes:notes.append(text)
    def tag(n):return n.tag.split('}')[-1]
    ids={}
    for n in root.iter():
        if n.get('id'):
            if n.get('id') in ids:raise ValueError('SVG contains duplicate IDs; references cannot be resolved')
            ids[n.get('id')]=n
    rules=[]
    for n in root.iter():
        if tag(n)=='style':
            css=re.sub(r'/\*.*?\*/','',n.text or '',flags=re.S)
            if re.sub(r'[^{}]+\{[^{}]*\}','',css).strip():raise ValueError('SVG stylesheet is too complex. Simplify the CSS')
            for selectors,body in re.findall(r'([^{}]+)\{([^{}]*)\}',css):
                for selector in selectors.split(','):
                    selector=selector.strip()
                    if not re.fullmatch(r'(?:[a-zA-Z][\w-]*)?(?:[.#][\w-]+)*|\*',selector):raise ValueError('Unsupported CSS selector: '+selector)
                    rules.append((selector,body))
            note('Expanded stylesheet')
    def declarations(raw):
        result={}
        for item in raw.split(';'):
            if not item.strip():continue
            if ':' not in item:raise ValueError('Invalid SVG style syntax')
            k,v=item.split(':',1);k=k.strip();v=v.strip()
            if '!important' in v:raise ValueError('!important styles are not supported')
            result[k]=v
        return result
    def matches(selector,n):
        kind=re.match(r'^[a-zA-Z][\w-]*',selector)
        if kind and kind[0]!=tag(n):return False
        return all((n.get('id')==value if prefix=='#' else value in n.get('class','').split()) for prefix,value in re.findall(r'([.#])([\w-]+)',selector))
    count=0
    def visit(n,stack=()):
        nonlocal count
        count+=1
        if count>512 or len(stack)>20:raise ValueError('Too many expanded SVG references or groups')
        kind=tag(n)
        if kind in ('metadata','namedview','title','desc','style','defs'):
            note('Removed editor metadata and unused definitions');return None
        if n.tag.startswith('{') and not n.tag.startswith('{'+SVG+'}'):raise ValueError('Unsupported non-SVG shape element: '+kind)
        if kind in ('script','foreignObject','image','text'):raise ValueError('Cannot convert to outlines: '+kind+'; outline text and vectorize images first')
        attrs=dict(n.attrib)
        for key in list(attrs):
            if key.startswith('data-') or key.startswith('aria-') or key in ('role','version') or key.startswith('{http://www.inkscape.org/namespaces/inkscape}') or key.startswith('{http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd}') or key in ('{http://www.w3.org/XML/1998/namespace}space',):
                del attrs[key];note('Removed editor metadata')
        style={}
        ordered=sorted(enumerate(rules),key=lambda item:(item[1][0].count('#'),item[1][0].count('.'),bool(re.match(r'^[a-zA-Z]',item[1][0])),item[0]))
        for _,(selector,body) in ordered:
            if matches(selector,n):style.update(declarations(body))
        style.update(declarations(attrs.pop('style','')))
        attrs.update(style);attrs.pop('class',None)
        if attrs.pop('display',None)=='none':note('Removed hidden shapes');return None
        if 'visibility' in attrs:raise ValueError('Inherited visibility is not supported. Remove hidden layers before exporting')
        if kind=='use':
            ref=attrs.pop('href',attrs.pop(XLINK,''))
            if not ref.startswith('#') or ref[1:] not in ids:raise ValueError('SVG references must target existing shapes in the same file')
            if ref in stack:raise ValueError('SVG contains circular references')
            target=ids[ref[1:]]
            if tag(target) in ('symbol','svg'):raise ValueError('Unlink symbol references first')
            x,y=attrs.pop('x','0'),attrs.pop('y','0')
            attrs['transform']=attrs.get('transform','')+' translate('+x+' '+y+')'
            result=ET.Element('g',attrs);child=visit(copy.deepcopy(target),stack+(ref,))
            if child is not None:result.append(child)
            note('Expanded internal references');return result
        if kind=='rect' and ('rx' in attrs or 'ry' in attrs):
            try:
                x,y,w,h=[float(attrs.get(k,'0')) for k in ('x','y','width','height')]
                rx=float(attrs.get('rx',attrs.get('ry','0')));ry=float(attrs.get('ry',attrs.get('rx','0')))
                if rx<0 or ry<0 or w<=0 or h<=0:raise ValueError()
                rx=min(rx,w/2);ry=min(ry,h/2)
            except ValueError:raise ValueError('Invalid rounded rectangle dimensions')
            if rx and ry:
                attrs['d']=f'M{x+rx} {y} H{x+w-rx} A{rx} {ry} 0 0 1 {x+w} {y+ry} V{y+h-ry} A{rx} {ry} 0 0 1 {x+w-rx} {y+h} H{x+rx} A{rx} {ry} 0 0 1 {x} {y+h-ry} V{y+ry} A{rx} {ry} 0 0 1 {x+rx} {y} Z'
                for k in ('x','y','width','height','rx','ry'):attrs.pop(k,None)
                kind='path';note('Converted rounded rectangles to paths')
            else:attrs.pop('rx',None);attrs.pop('ry',None)
        result=ET.Element(kind,attrs)
        for child in n:
            converted=visit(child,stack+('group',))
            if converted is not None:result.append(converted)
        return result
    result=visit(root)
    if result is None:raise ValueError('SVG has no usable artboard')
    if 'viewBox' not in result.attrib:
        def pixels(v):
            m=re.fullmatch(r'\s*([+]?(?:\d*\.\d+|\d+\.?\d*))\s*(px|mm|cm|in|pt|pc)?\s*',v)
            if not m:raise ValueError('Explicit width and height are required when viewBox is missing')
            return float(m[1])*{'px':1,'mm':96/25.4,'cm':96/2.54,'in':96,'pt':96/72,'pc':16,None:1}[m[2]]
        w,h=pixels(result.get('width','')),pixels(result.get('height',''))
        if w<=0 or h<=0:raise ValueError('Invalid SVG artboard size')
        result.set('viewBox',f'0 0 {w} {h}');note('Generated viewBox from artboard dimensions')
    return result,notes
