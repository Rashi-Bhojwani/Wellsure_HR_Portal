import sys, json
from PIL import Image; Image.MAX_IMAGE_PIXELS=None
import numpy as np
from scipy import ndimage
path, bg = sys.argv[1], tuple(map(int, sys.argv[2].split(',')))
im = Image.open(path).convert('RGB')
K=8
sm = np.asarray(im.resize((im.width//K, im.height//K), Image.NEAREST)).astype(int)
diff = np.abs(sm - np.array(bg)).sum(axis=2) > 6
lab, n = ndimage.label(diff)
objs = ndimage.find_objects(lab)
boxes=[]
for s in objs:
    y0,y1,x0,x1 = s[0].start*K, s[0].stop*K, s[1].start*K, s[1].stop*K
    if (x1-x0)>=200 and (y1-y0)>=40: boxes.append((x0,y0,x1,y1))
boxes.sort(key=lambda b:(b[1]//200, b[0]))
json.dump(boxes, open(sys.argv[3],'w'))
for b in boxes: print(b, b[2]-b[0], b[3]-b[1])
