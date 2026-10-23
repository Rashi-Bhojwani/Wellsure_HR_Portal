import sys, json
from PIL import Image; Image.MAX_IMAGE_PIXELS=None
import numpy as np
from scipy import ndimage
idx=json.load(open('docs/design/slices/index.json'))
cache={}
def frame(mode,fid):
    e=[e for e in idx[mode] if e['id']==fid][0]
    f='Responsive' if 'phone' in mode else mode.capitalize()
    if f not in cache: cache[f]=Image.open(f'docs/design/Wellsure_HR_Portal_{f}.png').convert('RGB')
    return np.asarray(cache[f].crop(tuple(e['box']))).astype(int)
for line in open(sys.argv[1]):
    line=line.strip()
    if not line or line.startswith('#'): continue
    parts=line.split(); name,mode,fid,x,y=parts[:5]; tol=int(parts[5]) if len(parts)>5 else 6
    a=frame(mode,fid); x,y=int(x),int(y)
    seed=a[y,x]
    m=(np.abs(a-seed).max(axis=2)<=tol)
    lab,_=ndimage.label(m); L=lab[y,x]
    ys,xs=np.where(lab==L)
    sc=1.0 if 'phone' in mode else 0.85
    w=(xs.max()-xs.min()+1)/sc; h=(ys.max()-ys.min()+1)/sc
    # exact colour = mode within region
    sub=a[lab==L]; k=(sub[:,0]<<16)|(sub[:,1]<<8)|sub[:,2]; v,c=np.unique(k,return_counts=True)
    print(f'{name:22s} #%06X  w=%.0f h=%.0f  at(%.0f,%.0f) [frame px %d..%d x %d..%d]'%(v[c.argmax()],w,h,xs.min()/sc,ys.min()/sc,xs.min(),xs.max(),ys.min(),ys.max()))
