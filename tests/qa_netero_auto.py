# Modo Netero v1.1 in the browser: the autopilot plays a long shared trunk, the questions start at the new move,
# a fail is repeated from a little before it (never before the line's start), and the badge fits on phones.
# Run `npm run dev` first.
import sys
from playwright.sync_api import sync_playwright
from qa_util import BASE, make_world, new_key, new_context, enter_with_key

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/qa'
# Sveshnikov up to 9.Bxf6 gxf6 (9 moves of Black), then six lines that leave it at move 10
TRUNK = 'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6 c1g5 a7a6 b5a3 b7b5 g5f6 g7f6'
TENTH = [('nd5', 'c3d5 f6f5'), ('bd3', 'f1d3 c6e7'), ('qh5', 'd1h5 f8g7'), ('nab1', 'a3b1 c8e6'), ('nxb5', 'a3b5 a6b5'), ('qf3', 'd1f3 c6d4')]
LINES = [(lid, f'{TRUNK} {tail}') for lid, tail in TENTH]
errors, fails = [], []
def log(*a): print(*a, flush=True)
def check(cond, msg):
    log(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

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

def open_netero(page, key):
    enter_with_key(page, key, name='Auto')
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(600)
    page.locator('.nt-scope').first.get_by_role('button', name='Empezar').click(); page.wait_for_timeout(600)
    page.locator('.netero .start-btn').click(); page.wait_for_timeout(300)

key = new_key('auto')
make_world('Sveshnikov QA', key, [('Sveshnikov', 'b', LINES)], subtitle='Autopiloto')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = new_context(b, 1366, 820)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    open_netero(page, key)

    starts = {}          # (line, pass) -> where it started asking
    saw_auto_badge = False
    tried_during_auto = None
    failed_line2 = False
    for _ in range(1500):
        st = state(page)
        if st is None or st['status'] == 'done' or page.locator('.nt-report').count():
            break
        if st['status'] == 'play' and (st['idx'], st['pass']) not in starts:
            starts[(st['idx'], st['pass'])] = (st['start'], st['autoUntil'])
        if st['auto'] and not st['paused']:
            if not saw_auto_badge and st['ply'] >= 6:
                saw_auto_badge = page.locator('.nt-auto').is_visible() and 'Autopiloto' in page.locator('.netero .status-text').inner_text()
                page.screenshot(path=f'{SHOTS}/na01-autopilot.png')
                # a move on the board during the autopilot is not taken
                before = st['fails']
                move(page, 'h7h6'); page.wait_for_timeout(120)
                tried_during_auto = state(page)['fails'] == before
            page.wait_for_timeout(80); continue
        if st['expected'] and not st['paused']:
            # second line: fail its first asked move (the new 10th move), once
            if st['idx'] == 1 and st['pass'] == 1 and not failed_line2:
                page.screenshot(path=f'{SHOTS}/na02-first-question.png')
                move(page, 'h7h6'); failed_line2 = True; page.wait_for_timeout(450); continue
            move(page, st['expected']); page.wait_for_timeout(230)
        else:
            page.wait_for_timeout(100)

    log('starts:', starts)
    check(starts.get((0, 1)) == (0, 0), 'first line: asked from the first move')
    check(starts.get((1, 1)) == (9, 19), 'second line: the trunk plays itself, asking from move 10')
    check(saw_auto_badge, 'autopilot: badge and status text shown')
    check(tried_during_auto is True, 'autopilot: the board takes no moves')
    check(starts.get((1, 2)) == (9, 19), 'repetition after a fail at the new move: never before the line\'s start')
    later = [v for (i, ps), v in starts.items() if ps == 1 and i >= 2]
    check(len(later) == 4 and all(v in [(9, 19), (0, 0)] for v in later), 'later lines: from move 10 (or the whole trunk again, when due)')
    page.wait_for_selector('.nt-report', timeout=20000); page.wait_for_timeout(800)
    rep = page.locator('.nt-report').inner_text()
    log('report:', rep.replace('\n', ' | ')[:240])
    check('14 de 15 jugadas a la primera' in rep, 'score: 9 trunk moves + 6 new ones, each counted once; one failed (14 of 15)')
    page.screenshot(path=f'{SHOTS}/na03-report.png')

    # phone: the badge fits next to the progress
    ph = new_context(b, 390, 844)
    pp = ph.new_page()
    pp.on('pageerror', lambda e: errors.append(str(e)))
    open_netero(pp, key)
    shot = False
    for _ in range(600):
        st = state(pp)
        if st is None or st['status'] == 'done':
            break
        if st['auto'] and not st['paused'] and st['ply'] >= 8 and st['idx'] >= 1:
            pp.screenshot(path=f'{SHOTS}/na04-phone-autopilot.png')
            badge = pp.locator('.nt-auto').bounding_box(); bar = pp.locator('.netero .player.top').bounding_box()
            check(badge is not None and badge['x'] + badge['width'] <= bar['x'] + bar['width'] + 1 and badge['y'] >= bar['y'] - 1, 'phone: the badge fits in the top bar')
            shot = True
            break
        if st['expected'] and not st['paused']:
            move(pp, st['expected']); pp.wait_for_timeout(230)
        else:
            pp.wait_for_timeout(80)
    check(shot, 'phone: reached the autopilot')
    b.close()

log('console errors:', errors)
check(not errors, 'no console errors')
log(f'netero autopilot checks: {len(fails)} failed')
sys.exit(1 if fails else 0)
