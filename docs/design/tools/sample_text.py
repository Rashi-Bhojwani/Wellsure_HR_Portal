import sys, json
from PIL import Image; Image.MAX_IMAGE_PIXELS=None
import numpy as np
from collections import Counter
idx=json.load(open('docs/design/slices/index.json'))
cache={}
def frame(mode,fid):
    e=[e for e in idx[mode] if e['id']==fid][0]
    f='Responsive' if 'phone' in mode else mode.capitalize()
    if f not in cache: cache[f]=Image.open(f'docs/design/Wellsure_HR_Portal_{f}.png').convert('RGB')
    return cache[f].crop(tuple(e['box']))
for line in open(sys.argv[1]):
    line=line.strip()
    if not line or line.startswith('#'): continue
    name,mode,fid,x0,y0,x1,y1=line.split()
    a=np.asarray(frame(mode,fid).crop((int(x0),int(y0),int(x1),int(y1)))).reshape(-1,3)
    c=Counter(map(tuple,a)); bg=c.most_common(1)[0][0]
    lum=lambda p:0.2126*p[0]+0.7152*p[1]+0.0722*p[2]
    # 'ink' = most extreme (vs bg) colour with >=4 px
    pts=[p for p,n in c.items() if n>=2]
    dark=lum(bg)<128
    srt=sorted(pts,key=lambda p:lum(p))
    ink=srt[-1] if dark else srt[0]
    sat=max(pts,key=lambda p:max(p)-min(p))
    # median of the 5% most-extreme pixels (robust text colour)
    allp=sorted(a.tolist(),key=lambda p:lum(p),reverse=dark)
    k=max(3,len(allp)//40); ext=tuple(int(x) for x in np.median(np.array(allp[:k]),axis=0))
    top=' '.join('#%02X%02X%02X:%d'%(p+(n,)) for p,n in c.most_common(2))
    print(f'{name:20s} bg=#%02X%02X%02X ext=#%02X%02X%02X ink=#%02X%02X%02X sat=#%02X%02X%02X [{top}]'%(bg+ext+ink+sat)); continue
    top=' '.join('#%02X%02X%02X:%d'%(p+(n,)) for p,n in c.most_common(3))
    print(f'{name:28s} bg=#%02X%02X%02X ink=#%02X%02X%02X  [{top}]'%(bg+ink))
