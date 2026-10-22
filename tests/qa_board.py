"""Board integrity QA: pieces on the right squares and centred, across tab switches, resizes and orientation."""
import sys, json, io, urllib.request
from playwright.sync_api import sync_playwright
from qa_util import make_world, new_key, new_context, enter_with_key, begin
from PIL import Image
import numpy as np

BASE = 'http://localhost:8790'
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
# Benko-like line, user = black
LINE = "d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 g7g6 b1c3 c8a6 e2e4 a6f1 e1f1 d7d6 g1f3 f8g7 g2g3 e8g8 f1g2 b8d7".split()

KEY = new_key('benko')

def setup():
    return make_world('Benko Gambit', KEY, [('Benko Trayn 1', 'b', [('l1', ' '.join(LINE))])], hue=30, subtitle='Negras')

# ---- checks ----
PIECE_JS = """() => {
  const board = document.querySelector('.train cg-board');
  const b = board.getBoundingClientRect();
  const white = board.closest('.cg-wrap').classList.contains('orientation-white');
  const sq = b.width / 8, out = [];
  for (const p of board.querySelectorAll('piece')) {
    if (p.classList.contains('ghost') || p.classList.contains('fading') || p.classList.contains('anim')) continue;
    const r = p.getBoundingClientRect();
    const cx = r.x + r.width / 2 - b.x, cy = r.y + r.height / 2 - b.y;
    let col = Math.floor(cx / sq), row = Math.floor(cy / sq);
    const file = white ? col : 7 - col, rank = white ? 7 - row : row;
    out.push({ sq: 'abcdefgh'[file] + (rank + 1), cls: p.className, off: Math.hypot(cx - (col + .5) * sq, cy - (row + .5) * sq) / sq, w: r.width / sq });
  }
  return { size: b.width, pieces: out };
}"""

def fen_map(fen):
    m, rows = {}, fen.split(' ')[0].split('/')
    names = {'p': 'pawn', 'n': 'knight', 'b': 'bishop', 'r': 'rook', 'q': 'queen', 'k': 'king'}
    for i, row in enumerate(rows):
        f = 0
        for ch in row:
            if ch.isdigit(): f += int(ch)
            else:
                m['abcdefgh'][f] if False else None
                m['abcdefgh'[f] + str(8 - i)] = ('white ' if ch.isupper() else 'black ') + names[ch.lower()]
                f += 1
    return m

def check(page, label):
    page.wait_for_timeout(900)
    data = page.evaluate(PIECE_JS)
    fen = page.evaluate("window.__traynskoFen ? window.__traynskoFen() : null")
    problems = []
    if data['size'] < 100: problems.append(f"board size {data['size']}")
    got = {}
    for p in data['pieces']:
        if p['off'] > 0.02: problems.append(f"{p['cls']} off-centre {p['off']:.3f} at {p['sq']}")
        if abs(p['w'] - 1) > 0.02: problems.append(f"{p['cls']} wrong size {p['w']:.3f}")
        got[p['sq']] = ' '.join(c for c in p['cls'].split() if c in ('white', 'black', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'))
    if fen:
        exp = fen_map(fen)
        norm = lambda s: ' '.join(sorted(s.split()))
        for k in set(exp) | set(got):
            if norm(exp.get(k, '')) != norm(got.get(k, '')): problems.append(f"square {k}: expected '{exp.get(k)}' got '{got.get(k)}'")
    print(('OK   ' if not problems else 'FAIL ') + label + ('' if not problems else ' -> ' + '; '.join(problems[:6])), flush=True)
    return not problems

def artwork_centering(page, label):
    """Pixel check: centre of the drawn piece vs centre of its square (start position)."""
    page.add_style_tag(content=".train cg-board{background:#ff00ff!important;background-image:none!important}.train coords{display:none!important}.train square{background:none!important}.train .ready-layer{display:none!important}")
    page.wait_for_timeout(200)
    box = page.locator('.train cg-board').bounding_box()
    img = np.array(Image.open(io.BytesIO(page.screenshot(clip=box))).convert('RGB')).astype(int)
    h, w, _ = img.shape; s = w / 8
    worst = []
    for r in range(8):
        for c in range(8):
            cell = img[int(r*s)+2:int((r+1)*s)-2, int(c*s)+2:int((c+1)*s)-2]
            mask = ~((cell[:,:,0] > 200) & (cell[:,:,1] < 60) & (cell[:,:,2] > 200))
            if mask.sum() < 30: continue
            ys, xs = np.where(mask)
            dx = ((xs.min() + xs.max()) / 2 + 2 - s / 2) / s
            dy = ((ys.min() + ys.max()) / 2 + 2 - s / 2) / s
            worst.append((abs(dx) + abs(dy), r, c, round(dx, 3), round(dy, 3)))
    worst.sort(reverse=True)
    print(f"ART  {label}: worst offsets (row, col, dx, dy as fraction of square): {[(x[1], x[2], x[3], x[4]) for x in worst[:4]]}", flush=True)
    return worst[0][0] if worst else 0

if __name__ == '__main__':
    w = setup()
    ok = True
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, vp, mobile in [('desktop', {'width': 1440, 'height': 900}, False), ('phone', {'width': 390, 'height': 844}, True)]:
            ctx = new_context(b, vp['width'], vp['height'], touch=mobile)
            page = ctx.new_page()
            errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
            enter_with_key(page, KEY)
            ok &= check(page, f'{name}: waiting to start (black)')
            begin(page)
            ok &= check(page, f'{name}: start of line (black)')
            def sq(s):
                box = page.locator('.train cg-board').bounding_box(); u = box['width'] / 8
                return box['x'] + (7 - (ord(s[0]) - 97) + .5) * u, box['y'] + (int(s[1]) - 1 + .5) * u
            # play first black moves
            for i in range(1, 7, 2):
                page.wait_for_timeout(500); page.mouse.click(*sq(LINE[i][:2])); page.wait_for_timeout(50); page.mouse.click(*sq(LINE[i][2:4]))
            ok &= check(page, f'{name}: mid-line')
            tabs = page.locator('.tab')
            for t in ['Partidas', 'Bots', 'Ajustes']:
                tabs.filter(has_text=t).click(); page.wait_for_timeout(1300)
                tabs.filter(has_text='Entrenar').click()
                ok &= check(page, f'{name}: back from {t}')
            # finish line while on another tab for the bot phase
            for i in range(7, len(LINE), 2):
                page.wait_for_timeout(500); page.mouse.click(*sq(LINE[i][:2])); page.wait_for_timeout(50); page.mouse.click(*sq(LINE[i][2:4]))
            page.wait_for_timeout(600)
            tabs.filter(has_text='Partidas').click(); page.wait_for_timeout(7000)   # bot moves while hidden
            tabs.filter(has_text='Entrenar').click()
            ok &= check(page, f'{name}: back after bot moved while hidden')
            page.screenshot(path=f'{SHOTS}/qa-{name}-after-hidden.png')
            # worst case: the board's box collapses while moves happen (what a hidden screen does), then returns
            page.evaluate("document.querySelector('.train .board-area').style.display='none'")
            page.wait_for_timeout(6000)
            page.evaluate("document.querySelector('.train .board-area').style.display=''")
            page.wait_for_timeout(1200)
            ok &= check(page, f'{name}: self-heal after collapsed board')
            page.set_viewport_size({'width': vp['width'] - 120, 'height': vp['height'] - 90}); page.wait_for_timeout(500)
            ok &= check(page, f'{name}: after resize')
            # turning the device (or the window) over: portrait <-> landscape layouts
            page.set_viewport_size({'width': vp['height'], 'height': vp['width']}); page.wait_for_timeout(500)
            ok &= check(page, f'{name}: rotated')
            page.set_viewport_size(vp); page.wait_for_timeout(500)
            ok &= check(page, f'{name}: rotated back')
            # fresh line for pixel centering
            page.reload(); page.wait_for_timeout(1500)
            artwork_centering(page, name)
            page.screenshot(path=f'{SHOTS}/qa-{name}-art.png')
            if errs: print('page errors', errs[:3]); ok = False
            ctx.close()
        b.close()
    print('RESULT', 'PASS' if ok else 'FAIL')
