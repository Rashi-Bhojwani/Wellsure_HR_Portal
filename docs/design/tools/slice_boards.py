import json, os, sys
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS=None
SECTIONS=['auth','home','employees','time-off','attendance','payroll','recruitment','documents','checklist','news','reports','settings','notifications','help']
TITLES=['Authentication & Onboarding','Home - Dashboard','Employees','Time Off','Attendance','Payroll','Recruitment','Documents','Checklist','News','Reports','Settings','Notifications & Messages','Help Center']
root='docs/design'
out=root+'/slices'
try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 28)
except Exception: font=ImageFont.load_default()
def save_jpg(img, path, maxkb=380):
    q=88
    while True:
        img.save(path, 'JPEG', quality=q, optimize=True)
        if os.path.getsize(path) < maxkb*1024 or q<=40: return
        q-=6
index={}
# ---------- desktop boards: frames on a fixed grid, same in light and dark ----------
boxes=json.load(open(sys.argv[1]))
frames=[]; bars=[]
for (x0,y0,x1,y1) in boxes:
    if x1-x0>=6000: bars.append(y0); continue
    if x1-x0>2000:  # the merged onboarding block: split into a 2x2 grid of frames
        for yy in (y0, y0+1000):
            for xx in (x0, x0+1296): frames.append((xx,yy,xx+1224,yy+872))
        continue
    if x0==1256: x0,x1=1296,2528
    frames.append((x0,y0,x0+1232 if x1-x0>1228 else x0+1224,y1))
bars=sorted(bars)[1:]  # first bar is the board title ("Light Mode")
assert len(bars)==len(SECTIONS), bars
def section_of(y):
    i=max(k for k,b in enumerate(bars) if b<y); return i
frames.sort(key=lambda f:(f[1],f[0]))
for mode in ('light','dark'):
    im=Image.open(f'{root}/Wellsure_HR_Portal_{mode.capitalize()}.png').convert('RGB')
    counters={}
    per={}
    for f in frames:
        s=SECTIONS[section_of(f[1])]; counters[s]=counters.get(s,0)+1
        fid=f'{s}-{counters[s]:02d}'
        d=f'{out}/{mode}/{s}'; os.makedirs(d,exist_ok=True)
        crop=im.crop(f); p=f'{d}/{fid}.jpg'; save_jpg(crop,p)
        per.setdefault(s,[]).append((fid,crop))
        index.setdefault(mode,[]).append({'id':fid,'section':s,'box':f,'file':p})
    for i,s in enumerate(SECTIONS):
        items=per[s]; cols=5; tw,th=408,291; pad=16; lab=40
        rows=(len(items)+cols-1)//cols
        sheet=Image.new('RGB',(cols*(tw+pad)+pad, 70+rows*(th+lab+pad)),(245,245,245) if mode=='light' else (20,24,32))
        dr=ImageDraw.Draw(sheet); fg=(20,20,20) if mode=='light' else (235,235,235)
        dr.text((pad,18),f'{TITLES[i]} ({mode}) - {len(items)} frames',fill=fg,font=font)
        for k,(fid,crop) in enumerate(items):
            r,c=divmod(k,cols); x=pad+c*(tw+pad); y=70+r*(th+lab+pad)
            dr.text((x,y+4),fid,fill=fg,font=font)
            sheet.paste(crop.resize((tw,th)),(x,y+lab))
        save_jpg(sheet,f'{out}/{mode}/{s}/_contact-{s}.jpg')
# ---------- responsive board: phone frames, light left half and dark right half ----------
rb=json.load(open(sys.argv[2]))
im=Image.open(f'{root}/Wellsure_HR_Portal_Responsive.png').convert('RGB')
for mode,(xa,xb) in (('light',(0,9000)),('dark',(9000,20000))):
    bx=[b for b in rb if xa<=b[0]<xb]
    rbars=sorted(b[1] for b in bx if b[2]-b[0]>1500)[1:]
    assert len(rbars)==len(SECTIONS),(mode,len(rbars))
    ph=sorted([b for b in bx if b[2]-b[0]<500],key=lambda b:(b[1],b[0]))
    by={}
    for b in ph:
        i=max(k for k,y in enumerate(rbars) if y<b[1]); by.setdefault(SECTIONS[i],[]).append(b)
    for s,lst in by.items():
        d=f'{out}/{mode}-phone/{s}'; os.makedirs(d,exist_ok=True)
        for n in range(0,len(lst),4):
            grp=lst[n:n+4]; W=sum(b[2]-b[0] for b in grp)+16*(len(grp)+1); H=860
            strip=Image.new('RGB',(W,H),(229,229,229) if mode=='light' else (8,11,18))
            dr=ImageDraw.Draw(strip); x=16
            for j,b in enumerate(grp):
                fid=f'm-{s}-{n+j+1:02d}'
                dr.text((x,6),fid,fill=(120,120,120),font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',20) if hasattr(font,'path') else font)
                strip.paste(im.crop(tuple(b)),(x,40)); x+=b[2]-b[0]+16
                index.setdefault(mode+'-phone',[]).append({'id':fid,'section':s,'box':b,'file':f'{d}/m-{s}-{n//4+1:02d}.jpg'})
            save_jpg(strip,f'{d}/m-{s}-{n//4+1:02d}.jpg')
json.dump(index,open(f'{out}/index.json','w'),indent=1)
print({k:len(v) for k,v in index.items()})
