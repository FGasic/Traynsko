"""Layout QA across phones, tablets and desktops (portrait and landscape).
For every viewport: everything on the training screen fits without scrolling and above the tab bar, nothing overflows
sideways, the board is square and aligned with the player strips, and the controls of each phase are reachable.
Saves screenshots (and a contact sheet) to the folder given as first argument. Exit code 1 on failure.
Run against the dev server (npm run dev)."""
import sys, os, json, random, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8790'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/qa-layout'
ONLY = sys.argv[2].split(',') if len(sys.argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
LINE = "d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6".split()

# (name, css width, css height = area the browser leaves to the page, touch device)
VIEWPORTS = [
    ('phone-320', 320, 460, True),       # oldest small phones, browser bars shown: scrolling allowed
    ('iphone-se', 375, 553, True),       # Safari with both bars
    ('brave-360', 360, 640, True),       # Android with top and bottom browser bars (Brave, Samsung)
    ('iphone-14', 390, 664, True),
    ('pixel-7', 412, 780, True),
    ('promax-430', 430, 740, True),
    ('ipad-mini', 744, 1000, True),
    ('ipad-820', 820, 1100, True),
    ('phone-land', 844, 340, True),      # phone held sideways
    ('android-land', 780, 330, True),
    ('ipad-land', 1180, 760, True),
    ('desk-1000', 1000, 700, False),
    ('laptop', 1366, 657, False),
    ('desk-1280', 1280, 720, False),
    ('desk-1920', 1920, 969, False),
]


SCROLL_OK = {'phone-320'}


def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + '/api/' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'x-test-ip': f'10.9.{random.randint(0, 255)}.{random.randint(1, 254)}', **({'Authorization': 'Bearer ' + token} if token else {})})
    return json.loads(urllib.request.urlopen(req).read())


def setup():
    t = api('POST', 'admin/login', {'password': 'maestro-dev'})['token']
    w = api('POST', 'admin/worlds', {'name': 'Rossolimo V', 'subtitle': 'Negras', 'password': 'layout1', 'emblem': 'pawn', 'hue': 260}, t)['world']
    api('POST', f"admin/worlds/{w['id']}/reps", {'name': 'rossoVS', 'color': 'b', 'lines': [
        {'id': 'l1', 'event': 'Benko', 'white': 'Corta', 'black': 'QA', 'uci': ' '.join(LINE)}]}, t)


MEASURE = """() => {
  const vw = innerWidth, vh = innerHeight, out = { problems: [] };
  const train = document.querySelector('.train');
  const nav = document.querySelector('.tabs');
  const nb = nav.getBoundingClientRect();
  const navFixed = getComputedStyle(nav).position === 'fixed';
  const limit = navFixed ? nb.top : vh;
  out.scroll = train.scrollHeight - train.clientHeight;
  out.layout = getComputedStyle(train).getPropertyValue('--layout').trim();
  const board = document.querySelector('.train cg-board').getBoundingClientRect();
  out.board = Math.round(board.width);
  if (Math.abs(board.width - board.height) > 1) out.problems.push('board not square');
  if (board.width < 180) out.problems.push('board too small ' + board.width);
  // every visible control and panel of the training screen must be inside the viewport and above the tab bar
  const sel = '.train .player, .train .board-area, .train .status-card, .train .moves, .train .actions .btn, .train .status-card .btn, .train .confirm';
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const name = el.className.toString().split(' ')[0] || el.tagName;
    if (r.bottom > limit + 0.5) out.problems.push(`${name} below ${navFixed ? 'tab bar' : 'viewport'} by ${Math.round(r.bottom - limit)}px`);
    if (r.right > vw + 0.5 || r.left < -0.5) out.problems.push(`${name} outside sideways`);
  }
  // player strips aligned with the board (or, when the height limits the board, the board centred under them)
  for (const p of document.querySelectorAll('.train .player')) {
    const r = p.getBoundingClientRect();
    if (out.layout === 'side') continue;
    const l = board.left - r.left, rr = r.right - board.right;
    if (l < -1 || rr < -1 || Math.abs(l - rr) > 2 || (out.layout === 'wide' && (l > 2 || rr > 2))) out.problems.push(`player strip not aligned with board (${l.toFixed(1)}/${rr.toFixed(1)})`);
  }
  // the training layer itself must end above the tab bar (so anything can be reached by scrolling)
  const layer = document.querySelector('.train-layer').getBoundingClientRect();
  if (layer.bottom > limit + 0.5) out.problems.push('training layer runs under the tab bar');
  // nothing sticks out sideways anywhere
  if (document.documentElement.scrollWidth > vw + 1) out.problems.push('page wider than screen');
  for (const el of document.querySelectorAll('.topbar > *, .tabs .tab')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) out.problems.push('topbar item outside: ' + el.className);
  }
  const tb = document.querySelector('.topbar').getBoundingClientRect();
  for (const el of document.querySelectorAll('.topbar > *')) {
    if (getComputedStyle(el).position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width && (r.bottom > tb.bottom + 0.5 || r.top < tb.top - 0.5)) out.problems.push('topbar item overflows vertically: ' + el.className);
  }
  // clipped single-line texts (ellipsis) in the status area
  for (const el of document.querySelectorAll('.train .status-text, .train .pill, .train .btn, .train .player-name, .tab span')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    if (el.scrollWidth > el.clientWidth + 1) out.problems.push('text cut: ' + el.textContent.trim().slice(0, 30));
  }
  if (out.scroll > 1) out.problems.push('training screen needs scrolling: ' + out.scroll + 'px');
  return out;
}"""


def main():
    setup()
    ok = True
    shots = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, w, h, touch in VIEWPORTS:
            if ONLY and name not in ONLY: continue
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if touch else 1, is_mobile=touch and w < 1000, has_touch=touch)
            ctx.set_extra_http_headers({'x-test-ip': f'10.8.{random.randint(0, 255)}.{random.randint(1, 254)}'})  # dev server rate-limits per IP
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE); page.wait_for_timeout(700)
            page.locator('.world-card', has_text='Rossolimo V').first.click()
            page.fill('#gate-name', 'Franco Gasic'); page.fill('#gate-pass', 'layout1')
            page.get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1700)

            def sq(s):
                box = page.locator('.train cg-board').bounding_box(); u = box['width'] / 8
                return box['x'] + (7 - (ord(s[0]) - 97) + .5) * u, box['y'] + (int(s[1]) - 1 + .5) * u

            def play(uci, wait=700):
                page.mouse.click(*sq(uci[:2])); page.wait_for_timeout(60); page.mouse.click(*sq(uci[2:4])); page.wait_for_timeout(wait)

            def report(stage):
                nonlocal ok
                m = page.evaluate(MEASURE)
                bad = m['problems']
                if name in SCROLL_OK: bad = [x for x in bad if 'below tab bar' not in x and 'needs scrolling' not in x]
                print(('OK   ' if not bad else 'FAIL ') + f"{name:13} {stage:10} layout={m['layout'] or '?':8} board={m['board']}px" + ('' if not bad else ' -> ' + '; '.join(bad[:5])), flush=True)
                ok &= not bad
                f = f'{OUT}/{name}-{stage}.png'
                page.screenshot(path=f)
                shots.append((name, stage, f))

            # line phase with the hint button showing
            for _ in range(3): play('e7e6', 400)
            report('hint')
            page.locator('.train button', has_text='Ver').first.dispatch_event('click'); page.wait_for_timeout(250)
            for i in range(1, len(LINE), 2): play(LINE[i], 900)
            page.wait_for_timeout(4500)
            report('game')
            page.locator('.train .actions button', has_text='Abandonar').first.dispatch_event('click'); page.wait_for_timeout(250)
            report('confirm')
            page.locator('.train button', has_text='Sí').first.dispatch_event('click'); page.wait_for_timeout(900)
            report('sheet')
            page.locator('.sheet button', has_text='Ver tablero').first.dispatch_event('click'); page.wait_for_timeout(300)
            report('over')
            if errs: print('page errors', errs[:3]); ok = False
            ctx.close()
        b.close()
    # contact sheet per viewport
    try:
        from PIL import Image
        by = {}
        for n, s, f in shots: by.setdefault(n, []).append(f)
        for n, files in by.items():
            ims = [Image.open(f) for f in files]
            scale = 700 / max(im.height for im in ims)
            ims = [im.resize((int(im.width * scale), int(im.height * scale))) for im in ims]
            sheet = Image.new('RGB', (sum(im.width for im in ims) + 10 * (len(ims) - 1), max(im.height for im in ims)), (255, 255, 255))
            x = 0
            for im in ims: sheet.paste(im, (x, 0)); x += im.width + 10
            sheet.save(f'{OUT}/sheet-{n}.png')
    except Exception as e:
        print('contact sheet skipped:', e)
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
