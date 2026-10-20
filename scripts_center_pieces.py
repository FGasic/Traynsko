# Re-centres every cburnett piece on its square: measures the drawn bounding box of each SVG
# in Chromium and wraps the artwork in a translate() so the box centre sits at the square centre.
import re, base64, io, sys
from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np
SRC = 'node_modules/chessground/assets/chessground.cburnett.css'
css = open(SRC).read()
pat = re.compile(r"(\.cg-wrap piece\.(\w+)\.(\w+)\s*\{\s*background-image:\s*url\('data:image/svg\+xml;base64,)([^']+)('\))")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 900, 'height': 900})
    def measure(data):
        pg.set_content(f"<body style='margin:0'><img src='data:image/svg+xml;base64,{data}' style='width:900px;height:900px;display:block'></body>")
        a = np.array(Image.open(io.BytesIO(pg.screenshot(omit_background=True))))[:, :, 3]
        ys, xs = np.where(a > 20)
        return (ys.min() + ys.max() + 1) / 2 / 900, (xs.min() + xs.max() + 1) / 2 / 900
    def fix(m):
        svg = base64.b64decode(m.group(4)).decode()
        vc, hc = measure(m.group(4))
        dx, dy = (0.5 - hc) * 45, (0.5 - vc) * 45
        head = re.match(r'<svg[^>]*>', svg).group(0)
        body = svg[len(head):-len('</svg>')]
        out = f'{head}<g transform="translate({dx:.3f} {dy:.3f})">{body}</g></svg>'
        nvc, nhc = measure(base64.b64encode(out.encode()).decode())
        print(f'{m.group(3):5s} {m.group(2):6s} dx={dx:+.2f} dy={dy:+.2f}  ->  centre {nhc:.3f},{nvc:.3f}')
        return m.group(1) + base64.b64encode(out.encode()).decode() + m.group(5)
    new_css, n = pat.subn(fix, css)
    b.close()
assert n == 12, n
open('assets/pieces-centered.css', 'w').write('/* cburnett pieces (Colin M.L. Burnett, GPLv2+), re-centred on their squares by scripts_center_pieces.py */\n' + new_css)
