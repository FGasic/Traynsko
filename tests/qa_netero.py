# Modo Netero in the browser: full session with a fail and its repetition, pause, resume after reloading,
# the result and its record, «Repetir solo errores», the Atlas, phones.
# Run `DEV_FAKE_LICHESS=1 npm run dev` first; lichess.org is simulated (the code returned is the username).
import sys, json, os
from urllib.parse import urlparse, parse_qs, urlencode
from playwright.sync_api import sync_playwright
from qa_util import BASE, make_world, new_key, new_context

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/qa'
BENKO = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'benko-negras.json')))
CATALAN = 'd2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 f8e7 g1f3 e8g8'
errors, fails = [], []
def log(*a): print(*a, flush=True)
def check(cond, msg):
    log(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def fake_lichess(route, username='NeteroQA'):
    q = parse_qs(urlparse(route.request.url).query)
    back = q['redirect_uri'][0] + '?' + urlencode({'code': username, 'state': q['state'][0]})
    route.fulfill(status=302, headers={'Location': back})

def state(page):
    return page.evaluate('window.__neteroState && window.__neteroState()')

def sq(page, s):
    box = page.locator('.netero cg-board').bounding_box(); w = box['width'] / 8
    black = page.locator('.netero .cg-wrap.orientation-black').count() > 0
    f, r = ord(s[0]) - 97, int(s[1])
    if black: f, r = 7 - f, 9 - r
    return box['x'] + (f + .5) * w, box['y'] + (8 - r + .5) * w

def move(page, uci):
    page.mouse.click(*sq(page, uci[:2])); page.wait_for_timeout(40); page.mouse.click(*sq(page, uci[2:4]))

WRONG = {'g8f6': 'e7e6', 'd2d4': 'e2e4'}

def play(page, fail_first=False, until=None, limit=400):
    """Plays the expected moves until the session ends (or `until(state)` is true). The first move can be a fail."""
    failed = not fail_first
    for _ in range(limit):
        st = state(page)
        if st is None or st['status'] == 'done' or page.locator('.nt-report').count():
            return st
        if until and until(st):
            return st
        if st['expected'] and not st['paused']:
            if not failed and st['expected'] in WRONG:
                move(page, WRONG[st['expected']]); failed = True; page.wait_for_timeout(450); continue
            move(page, st['expected']); page.wait_for_timeout(260)
        else:
            page.wait_for_timeout(150)
    return state(page)

key = new_key('netero')
make_world('Benko QA', key, [
    ('Benko Principal', 'b', [(l['id'], l['uci']) for l in BENKO]),
    ('Catalana', 'w', [('cat1', CATALAN)]),
], subtitle='Modo Netero')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = new_context(b, 1366, 820)
    ctx.route('https://lichess.org/oauth*', lambda route: fake_lichess(route))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE); page.wait_for_timeout(800)
    page.fill('#key-name', 'Franco'); page.fill('#key-pass', key)
    page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1500)

    # guest: the lobby says nothing is kept, and offers the account
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(500)
    page.screenshot(path=f'{SHOTS}/n01-lobby-guest.png', full_page=True)
    check(page.locator('.nt-guest').count() == 1, 'guest notice in the lobby')
    check(page.locator('.nt-scope').count() == 3, 'scopes: whole repertoire + 2 chapters')
    page.locator('.nt-guest').get_by_role('button', name='Entrar con Lichess').click(); page.wait_for_timeout(2000)
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(800)
    check(page.locator('.nt-guest').count() == 0, 'signed in: no guest notice')
    check('Sin récord' in page.locator('.nt-scope').first.inner_text(), 'no record yet')
    page.screenshot(path=f'{SHOTS}/n02-lobby-account.png', full_page=True)

    # full session over the whole repertoire, with a fail on the first move
    page.locator('.nt-scope').first.get_by_role('button', name='Empezar').click(); page.wait_for_timeout(700)
    page.screenshot(path=f'{SHOTS}/n03-ready.png')
    st = state(page)
    check(st['status'] == 'ready' and st['total'] == 4, 'ready with the 4 lines of the repertoire')
    page.locator('.netero .start-btn').click(); page.wait_for_timeout(300)
    st = play(page, fail_first=True, until=lambda s: s['fails'] > 0)
    page.wait_for_timeout(200)
    check(st['fails'] == 1 and 'has-fails' in page.locator('.nt-fails').get_attribute('class'), 'a wrong move counts as a fail')
    page.screenshot(path=f'{SHOTS}/n04-fail.png')
    st = play(page, until=lambda s: s['pass'] == 2)
    page.wait_for_timeout(100)
    check(st['pass'] == 2, 'line with a fail: mandatory repetition')
    page.screenshot(path=f'{SHOTS}/n05-repetition.png')

    # pause: the clock stops and the board is hidden
    page.get_by_role('button', name='Pausa').click(); page.wait_for_timeout(300)
    t0 = state(page)['elapsed']; page.wait_for_timeout(1500); t1 = state(page)['elapsed']
    check(state(page)['paused'] and abs(t1 - t0) < 5, 'paused: the session clock stops')
    check(page.locator('.nt-pause').is_visible(), 'paused: the board is hidden')
    page.screenshot(path=f'{SHOTS}/n06-pause.png')
    page.locator('.nt-pause').get_by_role('button', name='Continuar').click(); page.wait_for_timeout(300)
    st = play(page, until=lambda s: s['idx'] >= 2)

    # close the app mid-session (reload): it can be resumed from the lobby
    before = state(page)
    page.reload(); page.wait_for_timeout(1500)
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(600)
    check(page.locator('.nt-resume').count() == 1, 'after reloading: the session in progress is offered')
    page.screenshot(path=f'{SHOTS}/n07-resume.png', full_page=True)
    page.locator('.nt-resume').get_by_role('button', name='Continuar').click(); page.wait_for_timeout(500)
    st = state(page)
    check(st['paused'] and st['idx'] == before['idx'] and st['fails'] == before['fails'] and st['nodes'] == before['nodes'], 'resumed where it was, paused')
    page.locator('.nt-pause').get_by_role('button', name='Continuar').click(); page.wait_for_timeout(300)
    play(page)
    page.wait_for_selector('.nt-report', timeout=15000); page.wait_for_timeout(1500)
    rep = page.locator('.nt-report').inner_text()
    log('report:', rep.replace('\n', ' | ')[:300])
    check('primer récord' in rep.lower(), 'first full session sets the record')
    check(page.locator('.nt-fails-list li').count() == 1, 'the failed move is listed')
    page.screenshot(path=f'{SHOTS}/n08-report.png')
    nota = int(page.locator('.nt-nota').inner_text())
    check(0 < nota < 100, f'nota below 100 with a fail ({nota})')

    # «Repetir solo errores»: the failed line only
    page.get_by_role('button', name='Repetir solo errores').click(); page.wait_for_timeout(600)
    st = state(page)
    check(st['status'] == 'ready' and st['total'] == 1, 'repeat errors: one line')
    page.locator('.netero .start-btn').click(); page.wait_for_timeout(300)
    play(page)
    page.wait_for_selector('.nt-report', timeout=15000); page.wait_for_timeout(1200)
    page.screenshot(path=f'{SHOTS}/n09-report-errors.png')
    page.locator('.nt-report').get_by_role('button', name='Netero').click(); page.wait_for_timeout(500)
    first = page.locator('.nt-scope').first.inner_text()
    check(str(nota) in first, 'the lobby shows the record')
    page.screenshot(path=f'{SHOTS}/n10-lobby-record.png', full_page=True)

    # the Atlas: the record (the Campaign has its own check, qa_campaign.py)
    page.locator('.tab', has_text='Atlas').click(); page.wait_for_timeout(800)
    atlas = page.locator('.nt-atlas:not(.camp-atlas)').inner_text()
    check(str(nota) in atlas, 'Atlas: Netero records')
    page.screenshot(path=f'{SHOTS}/n12-atlas.png', full_page=True)
    ctx.close()

    # phones: upright and sideways
    for (w, h, name) in [(390, 844, 'phone'), (360, 740, 'small'), (844, 390, 'landscape')]:
        c = new_context(b, w, h)
        pg = c.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE); pg.wait_for_timeout(800)
        pg.fill('#key-name', 'Movil'); pg.fill('#key-pass', key)
        pg.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); pg.wait_for_timeout(1500)
        pg.locator('.tab', has_text='Netero').click(); pg.wait_for_timeout(500)
        over = pg.evaluate("[...document.querySelectorAll('.tab span')].filter(s => s.scrollWidth > s.parentElement.clientWidth + 1).map(s => s.textContent)")
        check(not over, f'{name}: tab labels fit ({over})')
        pg.screenshot(path=f'{SHOTS}/n20-{name}-lobby.png')
        pg.locator('.nt-scope').first.get_by_role('button', name='Empezar').click(); pg.wait_for_timeout(600)
        pg.locator('.netero .start-btn').click(); pg.wait_for_timeout(300)
        play(pg, fail_first=True, until=lambda s: s['fails'] > 0 and s['expected'])
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{SHOTS}/n21-{name}-run.png')
        board = pg.locator('.netero cg-board').bounding_box()
        side = pg.locator('.netero .nt-stats').bounding_box()
        check(board['width'] > 150 and side and side['height'] > 0, f'{name}: board and score visible')
        vis = pg.evaluate("(() => { const r = document.querySelector('.netero .actions').getBoundingClientRect(); const nav = document.querySelector('.tabs').getBoundingClientRect(); return r.bottom <= (getComputedStyle(document.querySelector('.tabs')).position === 'fixed' ? nav.top + 1 : innerHeight + 1); })()")
        check(vis, f'{name}: actions above the tab bar')
        c.close()
    b.close()

log('console errors:', [e for e in errors if 'favicon' not in e][:5])
log(f'netero browser checks: {len(fails)} failed')
sys.exit(1 if fails or [e for e in errors if 'favicon' not in e] else 0)
