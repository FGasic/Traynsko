"""Saved-game viewer on phones, tablets and desktop: board visible and square, header complete, nothing clipped.

Run against `npm run dev`:  python3 tests/qa_viewer.py [outdir]
"""
import json, subprocess, sys, os
from playwright.sync_api import sync_playwright
from qa_util import BASE, api, make_world, new_key, new_context, enter_with_key

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/qa_viewer'
os.makedirs(OUT, exist_ok=True)

# a long, legal game (black to play the line), built with chess.js so the SANs are valid
SANS = json.loads(subprocess.check_output(['node', '-e', '''
const { Chess } = require("chess.js");
const c = new Chess(); const out = [];
const seq = ["d4","d5","Bf4","Nf6","e3","c5","Nd2","Nc6","c3","e6","Ngf3","Bd6","Bg3","O-O","Bd3","b6","Ne5","Bb7","f4","Ne7"];
for (const s of seq) out.push(c.move(s).san);
let i = 0;
while (out.length < 64 && !c.isGameOver()) { const ms = c.moves().sort(); const m = ms[(i++ * 7) % ms.length]; out.push(c.move(m).san); }
console.log(JSON.stringify(out));
'''], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

key = new_key('viewer')
make_world('Viewer QA', key, [('Sistema Londres', 'b', [('l1', 'd2d4 d7d5 c1f4 g8f6')])])
tok = api('POST', 'enter', {'password': key, 'name': 'QA'})['entries'][0]['token']
content = api('GET', 'content', token=tok)
rep = content['reps'][0]
api('POST', 'games', {'player': 'QA', 'game': {
    'repId': rep['id'], 'repName': rep['name'], 'lineId': 'l1', 'lineEvent': 'Sistema Londres',
    'lineWhite': '4.Cd3+5.e3', 'lineBlack': '6.Ac4 con un nombre de variante bastante largo', 'userColor': 'b',
    'botId': 'tormenta', 'botName': 'Tormenta', 'botElo': 2300,
    'result': '0-1', 'termination': 'Abandono', 'timeControl': '600+5',
    'sans': SANS, 'clocks': [600000 - i * 3000 for i in range(len(SANS))], 'linePlies': 8, 'lineErrors': 0}}, token=tok)

SIZES = [(360, 640), (360, 740), (384, 760), (393, 760), (412, 756), (412, 860), (430, 860), (320, 568),
         (768, 1024), (820, 1180), (740, 360), (915, 412), (1280, 800), (1440, 900), (1920, 1080)]

problems = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in SIZES:
        ctx = new_context(b, w, h)
        page = ctx.new_page()
        enter_with_key(page, key)
        page.locator('.tab', has_text='Partidas').click(); page.wait_for_timeout(900)
        page.locator('.game-list .game').first.click()
        page.wait_for_selector('.viewer cg-board', state='attached'); page.wait_for_timeout(900)
        m = page.evaluate('''() => {
          const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
          const body = document.querySelector('.viewer-body');
          return { vw: innerWidth, vh: innerHeight, board: r('.viewer cg-board'), area: r('.viewer .board-area'), nav: r('.viewer-nav'),
                   moves: r('.viewer-moves'), side: r('.viewer-side'), facts: r('.viewer-facts'), head: r('.viewer-head'), actions: r('.viewer-actions'), chip: r('.viewer .result-chip'),
                   scrollTop: body.scrollTop, bodyScroll: body.scrollHeight - body.clientHeight,
                   docScroll: document.scrollingElement.scrollWidth - innerWidth };
        }''')
        bd = m['board']
        tag = f'{w}x{h}'
        if not bd or bd['w'] < 150 or abs(bd['w'] - bd['h']) > 2:
            problems.append(f'{tag}: board {bd}')
        elif bd['y'] < m['head']['b'] - 1 or bd['b'] > h + 1:
            problems.append(f'{tag}: board not fully visible on open (top {bd["y"]:.0f}, bottom {bd["b"]:.0f}, scrollTop {m["scrollTop"]})')
        if bd and bd['r'] > w + 1:
            problems.append(f'{tag}: board overflows right')
        if m['docScroll'] > 0:
            problems.append(f'{tag}: page scrolls sideways')
        for k in ('side', 'facts', 'nav', 'head'):
            if m[k] and (m[k]['x'] < -1 or m[k]['r'] > w + 1):
                problems.append(f'{tag}: {k} off screen sideways (x {m[k]["x"]:.0f}, right {m[k]["r"]:.0f})')
        if m['nav'] and m['nav']['b'] > h + 1:
            problems.append(f'{tag}: navigation buttons below the fold')
        if m['moves'] and m['moves']['h'] < 60:
            problems.append(f'{tag}: move list squashed to {m["moves"]["h"]:.0f}px')
        before = page.evaluate("() => document.querySelector('.viewer cg-board').getBoundingClientRect().top")
        page.locator('.viewer-nav [aria-label=Inicio]').click(); page.wait_for_timeout(200)
        for _ in range(6): page.locator('.viewer-nav [aria-label=Siguiente]').click()
        page.wait_for_timeout(250)
        st = page.evaluate('''() => { const l = document.querySelector('.viewer-moves'), c = l.querySelector('.mv.current');
          const lr = l.getBoundingClientRect(), cr = c.getBoundingClientRect();
          return { top: document.querySelector('.viewer cg-board').getBoundingClientRect().top, visible: cr.top >= lr.top - 1 && cr.bottom <= lr.bottom + 1 }; }''')
        if abs(st['top'] - before) > 1:
            problems.append(f'{tag}: stepping through moves moved the board')
        if not st['visible']:
            problems.append(f'{tag}: current move scrolled out of the list')
        page.locator('.viewer-nav [aria-label=Final]').click(); page.wait_for_timeout(250)
        print(tag, json.dumps({k: m[k] for k in ('board', 'moves', 'scrollTop', 'bodyScroll')}))
        page.screenshot(path=f'{OUT}/viewer-{tag}.png')
        ctx.close()
    b.close()

print('\n'.join(problems) if problems else 'OK: viewer layout checks passed')
sys.exit(1 if problems else 0)
