"""Draws docs/design/compare/step1-tokens-{light,dark}.jpg: each token's board sample next to
the value we chose, with its WCAG contrast against the surface it sits on.
Run from the repo root:  python3 -I docs/design/tools/swatches.py"""
from PIL import Image, ImageDraw, ImageFont
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def L(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def cr(a, b):
    x, y = sorted([L(a), L(b)], reverse=True)
    return (x + .05) / (y + .05)
ROWS = {
 'light': [  # token, board sample, ours, measured against
  ('bg.page', '#FAFAFA', '#FAFAFA', None), ('bg.surface', '#FFFFFF', '#FFFFFF', None),
  ('bg.subtle (search, active child)', '#F8F8F8', '#F8F8F8', None), ('border.default', '#EAEAEA', '#EAEAEA', '#FFFFFF'),
  ('border.control', '#F0F0F0', '#DADDE2', '#FFFFFF'),
  ('text.primary', '#121828', '#121828', '#FFFFFF'), ('text.body', '#2C2B31', '#2C2B31', '#FFFFFF'),
  ('text.secondary', '#8A8C91', '#6B7079', '#FFFFFF'), ('text.placeholder', '#C1C3C7', '#70757D', '#FFFFFF'),
  ('primary (navy button)', '#121828', '#121828', '#FFFFFF'),
  ('accent (fills, radios, bars)', '#28A174', '#28A174', '#FFFFFF'), ('accent.text (links, tabs)', '#28A174', '#1A7F5A', '#FFFFFF'),
  ('nav.active pill (white text)', '#0CAD5D', '#0A8048', '#FFFFFF'),
  ('info.bg', '#ECF3FD', '#ECF3FD', None), ('info.text', '#2D7AEF', '#1F5FC4', '#ECF3FD'),
  ('danger (delete, badge)', '#ED3838', '#D12E2E', '#FFFFFF'), ('edit blue', '#2D7AEF', '#1F66D1', '#FFFFFF'),
  ('chip.success text / bg', '#28A174', '#1B7A56', '#EAF6F2'), ('chip.warning text / bg', '#DBC571', '#8A6D00', '#FFF5D0'),
  ('chip.purple text / bg', '#9F8BCD', '#6A3FD9', '#F1EDFF'), ('chip.danger text / bg', '#BD7477', '#C0262D', '#FCEDEC'),
 ],
 'dark': [
  ('bg.page', '#121828', '#121828', None), ('bg.surface (sidebar, cards)', '#202938', '#202938', None),
  ('bg.raised (table head, fills)', '#303948', '#303948', None), ('border.control', '#3C4554', '#4A5363', '#202938'),
  ('text.primary', '#FFFFFF', '#FFFFFF', '#202938'), ('text.body', '#A7AEB7', '#A7AEB7', '#202938'),
  ('text.secondary', '#5E6776', '#8C95A4', '#202938'), ('text.header-on-raised', '#C6CFDE', '#C6CFDE', '#303948'),
  ('primary (white button)', '#FFFFFF', '#FFFFFF', '#121828'),
  ('accent (fills)', '#28A174', '#28A174', '#202938'), ('accent.text', '#28A174', '#34C08E', '#202938'),
  ('nav.active pill', '#0CAD5D', '#0A8048', '#FFFFFF'),
  ('info banner (kept light)', '#ECF3FD', '#ECF3FD', None), ('danger', '#ED3838', '#F06A6A', '#202938'),
 ]}
for mode, rows in ROWS.items():
    W, H = 1100, 70 + 46 * len(rows)
    page = '#FFFFFF' if mode == 'light' else '#121828'; ink = '#121828' if mode == 'light' else '#FFFFFF'
    im = Image.new('RGB', (W, H), page); d = ImageDraw.Draw(im)
    f = ImageFont.truetype(F, 15); fb = ImageFont.truetype(F, 17)
    d.text((16, 16), f'Wellsure tokens ({mode}) - board sample vs ours', fill=ink, font=fb)
    d.text((420, 46), 'board', fill=ink, font=f); d.text((560, 46), 'ours', fill=ink, font=f); d.text((700, 46), 'contrast (board -> ours)', fill=ink, font=f)
    for i, (name, b, o, on) in enumerate(rows):
        y = 70 + i * 46
        d.text((16, y + 12), name, fill=ink, font=f)
        for x, c in ((420, b), (560, o)):
            d.rounded_rectangle((x, y + 4, x + 120, y + 38), 8, fill=c, outline='#888888')
            t = '#FFFFFF' if L(c) < .3 else '#121828'; d.text((x + 8, y + 13), c, fill=t, font=f)
        if on:
            d.text((700, y + 12), f'{cr(b, on):.2f} -> {cr(o, on):.2f}  on {on}', fill=ink, font=f)
    im.save(f'docs/design/compare/step1-tokens-{mode}.jpg', quality=90)
print('ok')
