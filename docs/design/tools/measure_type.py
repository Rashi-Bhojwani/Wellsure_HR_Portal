import sys, json
from PIL import Image; Image.MAX_IMAGE_PIXELS=None
import numpy as np
idx=json.load(open('docs/design/slices/index.json'))
cache={}
for line in open(sys.argv[1]):
    if not line.strip() or line.startswith('#'): continue
    name,mode,fid,x0,y0,x1,y1=line.split()
    e=[e for e in idx[mode] if e['id']==fid][0]
    f='Responsive' if 'phone' in mode else mode.capitalize()
    if f not in cache: cache[f]=Image.open(f'docs/design/Wellsure_HR_Portal_{f}.png').convert('L')
    a=np.asarray(cache[f].crop(tuple(e['box'])).crop((int(x0),int(y0),int(x1),int(y1)))).astype(int)
    bg=np.median(a); m=np.abs(a-bg)>60
    ys,xs=np.where(m)
    sc=1.0 if 'phone' in mode else 0.85
    if len(ys)==0: print(name,'none'); continue
    h=(ys.max()-ys.min()+1)/sc
    print(f'{name:18s} glyph-height={h:.1f}px  => font ≈ {h/0.72:.1f}px (if cap-only)')
