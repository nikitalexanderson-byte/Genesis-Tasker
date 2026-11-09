from pathlib import Path
from urllib.request import urlopen
import json, tarfile, io, hashlib, re, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / 'app/src/main/res/font'
DRAW = ROOT / 'app/src/main/res/drawable'
LICENSE = ROOT / 'third-party-licenses'
NAMES = '''menu x chevron-left chevron-right chevron-down chevron-up ellipsis search sliders-horizontal arrow-up-down refresh-cw plus minus pencil trash-2 folder folder-plus list-checks list layout-dashboard calendar-days calendar-range sun moon sparkles settings user-round bell globe external-link heart-pulse network check check-check mic download upload archive archive-restore history eye eye-off move arrow-up arrow-down undo-2 chart-no-axes-column inbox copy git-branch link play pause timer wand-sparkles alarm-clock shield-check book-open log-out chart-no-axes-gantt layout-template list-tree palette users-round pin star thumbs-up thumbs-down bookmark file-json file-text message-circle paperclip send key-round lock-keyhole'''.split()
def fetch(url):
    with urlopen(url, timeout=90) as response: return response.read()
def sha(data): return hashlib.sha256(data).hexdigest()
FONT.mkdir(parents=True, exist_ok=True)
DRAW.mkdir(parents=True, exist_ok=True)
manifest = {'fonts': [], 'icons': []}
# Pinned official Google Fonts repository revision is recorded with the copied bytes.
revision = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0'
for family, filename, target in [('inter', 'Inter[opsz,wght].ttf', 'inter.ttf'), ('sourceserif4', 'SourceSerif4[opsz,wght].ttf', 'source_serif_4.ttf')]:
    from urllib.parse import quote
    base = f'https://raw.githubusercontent.com/google/fonts/{revision}/ofl/{family}/'
    source = base + quote(filename)
    content = fetch(source)
    (FONT / target).write_bytes(content)
    (LICENSE / (family + '-OFL.txt')).write_bytes(fetch(base+'OFL.txt'))
    manifest['fonts'].append({'family':family,'source':source,'revision':revision,'target':target,'bytes':len(content),'sha256':sha(content),'modified':False})
version='1.61.0'
archive = fetch(f'https://registry.npmjs.org/lucide-static/-/lucide-static-{version}.tgz')
package = tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz')
files = {m.name:m for m in package.getmembers() if m.isfile()}
license_path = next(p for p in files if p.lower() in ['package/license','package/license.txt','package/license.md'])
(LICENSE/'lucide-LICENSE').write_bytes(package.extractfile(files[license_path]).read())
ns = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android',ns)
def a(key): return '{'+ns+'}'+key
def num(v): return f'{float(v):g}'
def path_for(e):
    t=e.tag.rsplit('}',1)[-1]; v=e.attrib
    if t=='path': return v['d']
    if t=='line': return f'M{v["x1"]},{v["y1"]} L{v["x2"]},{v["y2"]}'
    if t in ['polyline','polygon']:
        points=re.findall(r'-?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?',v['points'])
        assert len(points)%2==0
        return 'M'+' L'.join(','.join(points[i:i+2]) for i in range(0,len(points),2))+(' Z' if t=='polygon' else '')
    if t in ['circle','ellipse']:
        cx=float(v['cx']);cy=float(v['cy']);rx=float(v.get('r',v.get('rx',0)));ry=float(v.get('r',v.get('ry',0)))
        return f'M{num(cx-rx)},{num(cy)} A{num(rx)},{num(ry)} 0 1,0 {num(cx+rx)},{num(cy)} A{num(rx)},{num(ry)} 0 1,0 {num(cx-rx)},{num(cy)} Z'
    if t=='rect':
        x=float(v.get('x',0));y=float(v.get('y',0));w=float(v['width']);h=float(v['height']);rx=min(float(v.get('rx',v.get('ry',0))),w/2);ry=min(float(v.get('ry',v.get('rx',0))),h/2)
        if not rx or not ry:return f'M{num(x)},{num(y)} H{num(x+w)} V{num(y+h)} H{num(x)} Z'
        return f'M{num(x+rx)},{num(y)} H{num(x+w-rx)} A{num(rx)},{num(ry)} 0 0,1 {num(x+w)},{num(y+ry)} V{num(y+h-ry)} A{num(rx)},{num(ry)} 0 0,1 {num(x+w-rx)},{num(y+h)} H{num(x+rx)} A{num(rx)},{num(ry)} 0 0,1 {num(x)},{num(y+h-ry)} V{num(y+ry)} A{num(rx)},{num(ry)} 0 0,1 {num(x+rx)},{num(y)} Z'
    raise ValueError(t)
for name in NAMES:
    candidates=[p for p in files if p.endswith('/icons/'+name+'.svg')]
    assert len(candidates)==1,(name,candidates)
    source=package.extractfile(files[candidates[0]]).read()
    svg=ET.fromstring(source)
    vector=ET.Element('vector',{a('width'):'24dp',a('height'):'24dp',a('viewportWidth'):'24',a('viewportHeight'):'24'})
    def convert(parent, inherited):
        for e in parent:
            tag=e.tag.rsplit('}',1)[-1]
            style={**inherited,**e.attrib}
            if tag in ['title','desc']:continue
            if tag=='g':
                assert 'transform' not in e.attrib
                convert(e,style);continue
            assert 'transform' not in e.attrib
            path=path_for(e)
            attrs={a('pathData'):path,a('fillColor'):'#00000000',a('strokeColor'):'#FF000000',a('strokeWidth'):style.get('stroke-width','2'),a('strokeLineCap'):style.get('stroke-linecap','round'),a('strokeLineJoin'):style.get('stroke-linejoin','round')}
            fill=style.get('fill','none');stroke=style.get('stroke','currentColor')
            assert fill in ['none','currentColor'] and stroke in ['none','currentColor'],(fill,stroke)
            attrs[a('fillColor')]='#FF000000' if fill=='currentColor' else '#00000000'
            attrs[a('strokeColor')]='#00000000' if stroke=='none' else '#FF000000'
            ET.SubElement(vector,'path',attrs)
    convert(svg,svg.attrib)
    ET.indent(vector,space='    ')
    target='lucide_'+name.replace('-','_')+'.xml'
    xml=b'<?xml version="1.0" encoding="utf-8"?>\n<!-- Lucide '+version.encode()+b'; ISC License. Official source geometry, converted to VectorDrawable. -->\n'+ET.tostring(vector,encoding='utf-8')+b'\n'
    (DRAW/target).write_bytes(xml)
    manifest['icons'].append({'name':name,'package':f'lucide-static@{version}','source':candidates[0],'sourceSha256':sha(source),'target':target,'targetSha256':sha(xml),'paths':len(list(vector)),'strokeWidth':svg.attrib.get('stroke-width')})
manifest['lucidePackage']={'version':version,'url':f'https://registry.npmjs.org/lucide-static/-/lucide-static-{version}.tgz','sha256':sha(archive),'license':license_path}
(LICENSE/'genesis-assets-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
from fontTools.ttLib import TTFont
for row in manifest['fonts']:
    font=TTFont(FONT/row['target']);cmap=font.getBestCmap();required='АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя'
    assert all(ord(char) in cmap for char in required)
    print(row['family'],len(cmap),'glyph mappings; Cyrillic verified;',row['bytes'],'bytes')
print(len(manifest['icons']),'official Lucide icons converted and XML parsed')
