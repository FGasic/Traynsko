# La Campaña and the Top 3 in the browser: starting level, memory phase with a fail, the game from the end of the line,
# carrying on after reloading, the resignation warning, the result, the Atlas, Entrenar's reminder, the Top 3 with two
# accounts and hiding from rankings, phones.
# Run `DEV_FAKE_LICHESS=1 npm run dev` first; lichess.org is simulated (the code returned is the username).
import sys, json, os
from urllib.parse import urlparse, parse_qs, urlencode
from playwright.sync_api import sync_playwright
from qa_util import BASE, make_world, new_key, new_context

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/qa'
HERE = os.path.dirname(os.path.abspath(__file__))
BENKO = json.load(open(os.path.join(HERE, 'fixtures', 'benko-negras.json')))
errors, fails = [], []
def log(*a): print(*a, flush=True)
def check(cond, msg):
    log(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def lichess_as(username):
    def handler(route):
        q = parse_qs(urlparse(route.request.url).query)
        back = q['redirect_uri'][0] + '?' + urlencode({'code': username, 'state': q['state'][0]})
        route.fulfill(status=302, headers={'Location': back})
    return handler

def sq(page, board, s):
    box = page.locator(f'{board} cg-board').bounding_box(); w = box['width'] / 8
    black = page.locator(f'{board} .cg-wrap.orientation-black').count() > 0
    f, r = ord(s[0]) - 97, int(s[1])
    if black: f, r = 7 - f, 9 - r
    return box['x'] + (f + .5) * w, box['y'] + (8 - r + .5) * w

def move(page, board, uci):
    page.mouse.click(*sq(page, board, uci[:2])); page.wait_for_timeout(40); page.mouse.click(*sq(page, board, uci[2:4]))

WRONG = {'g8f6': 'e7e6', 'd2d4': 'e2e4'}

def play_netero(page, fail_first=False, limit=400):
    failed = not fail_first
    for _ in range(limit):
        st = page.evaluate('window.__neteroState && window.__neteroState()')
        if st is None or st['status'] == 'done' or page.locator('.nt-report').count():
            return st
        if st['expected'] and not st['paused']:
            if not failed and st['expected'] in WRONG:
                move(page, '.netero', WRONG[st['expected']]); failed = True; page.wait_for_timeout(450); continue
            move(page, '.netero', st['expected']); page.wait_for_timeout(260)
        else:
            page.wait_for_timeout(150)

def game(page):
    return page.evaluate('window.__campaignGame && window.__campaignGame()')

def play_game(page, until_move, limit=600):
    """Plays the first legal move each turn until `until_move` (or the end of the game)."""
    for _ in range(limit):
        g = game(page)
        if not g or g['phase'] == 'over' or g['moveNo'] >= until_move:
            return g
        if g['userTurn'] and g['legal']:
            move(page, '.camp-game', g['legal'][0]); page.wait_for_timeout(350)
        else:
            page.wait_for_timeout(250)
    return game(page)

def enter(page, key, name):
    page.goto(BASE); page.wait_for_timeout(800)
    page.fill('#key-name', name); page.fill('#key-pass', key)
    page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1500)

def sign_in(page):
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(500)
    page.locator('.nt-guest').get_by_role('button', name='Entrar con Lichess').click(); page.wait_for_timeout(2000)
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(800)

key = new_key('camp')
make_world('Benko Campaña', key, [
    ('Benko Principal', 'b', [(l['id'], l['uci']) for l in BENKO]),
], subtitle='Campaña')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = new_context(b, 1366, 820)
    ctx.route('https://lichess.org/oauth*', lichess_as('CampQA'))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    enter(page, key, 'Franco')
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(500)
    check(page.locator('.camp-card').get_by_role('button', name='Entrar con Lichess').count() == 1, 'guest: the Campaign asks for an account')
    sign_in(page)

    # Entrenar reminds that today's Campaign is pending
    page.locator('.tab', has_text='Entrenar').click(); page.wait_for_timeout(800)
    check(page.locator('.camp-pick').count() == 1, 'Entrenar: «Campaña de hoy pendiente»')
    page.locator('.camp-pick').click(); page.wait_for_timeout(500)
    check(page.locator('.camp-card').count() == 1, 'the reminder leads to the Campaign')
    page.screenshot(path=f'{SHOTS}/c01-card.png', full_page=True)
    check(page.locator('#camp-start').count() == 1, 'first Campaign: the starting level can be chosen')
    page.locator('#camp-start button', has_text='2100').click(); page.wait_for_timeout(200)

    # memory phase: 3 lines (the repertoire has 3), with a fail
    page.get_by_role('button', name='Empezar la Campaña').click(); page.wait_for_timeout(700)
    st = page.evaluate('window.__neteroState()')
    check(st['status'] == 'ready' and st['total'] == 3, 'memory phase: 3 lines')
    page.locator('.netero .start-btn').click(); page.wait_for_timeout(300)
    play_netero(page, fail_first=True)
    page.wait_for_selector('.nt-report', timeout=20000); page.wait_for_timeout(600)
    sheet = page.locator('.nt-report').inner_text()
    check('memoria completada' in sheet.lower() and page.locator('.nt-fails-list li').count() == 1, 'memory phase: nota, the failed move, then the game')
    page.screenshot(path=f'{SHOTS}/c02-memory-done.png')
    page.get_by_role('button', name='Jugar la partida').click(); page.wait_for_timeout(1200)

    # the game starts where the line ends, against the rival at the chosen level
    g = game(page)
    check(g and not g['started'] and g['moveNo'] >= 5, f'game: starts after the line (move {g and g["moveNo"]})')
    strip = page.locator('.camp-game .player.top').inner_text()
    check('2100' in strip and 'GM' in strip, f'game: the rival is a GM at 2100 ({strip.strip()})')
    page.screenshot(path=f'{SHOTS}/c03-game-ready.png')
    page.locator('.camp-game .start-btn').click(); page.wait_for_timeout(500)
    g = play_game(page, (g['moveNo'] or 6) + 3)
    # the resignation warning before move 20
    page.locator('.camp-game').get_by_role('button', name='Abandonar').click(); page.wait_for_timeout(200)
    check('no cuenta para la racha' in page.locator('.camp-game .confirm').inner_text(), 'resigning before move 20 warns about the streak')
    page.screenshot(path=f'{SHOTS}/c04-resign-warning.png')
    page.locator('.camp-game .confirm').get_by_role('button', name='Seguir').click(); page.wait_for_timeout(200)

    # close the app mid-game: it carries on where it was
    for _ in range(40):
        g = game(page)
        if g['userTurn']: break
        page.wait_for_timeout(250)
    before = game(page)
    page.reload(); page.wait_for_timeout(1500)
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(600)
    check('Continuar la partida' in page.locator('.camp-card').inner_text(), 'after reloading: the card offers to carry on the game')
    page.locator('.camp-card').get_by_role('button', name='Continuar la partida').click(); page.wait_for_timeout(1200)
    after = game(page)
    check(after and after['fen'] == before['fen'] and not after['started'], 'restored: same position, waiting to carry on')
    page.locator('.camp-game .start-btn').click(); page.wait_for_timeout(400)
    g = play_game(page, 20)
    if g['phase'] != 'over':
        page.locator('.camp-game').get_by_role('button', name='Abandonar').click(); page.wait_for_timeout(200)
        page.locator('.camp-game .confirm').get_by_role('button', name='Sí, abandonar').click()
    page.wait_for_selector('.camp-result', timeout=20000); page.wait_for_timeout(1500)
    res = page.locator('.camp-result').inner_text()
    log('result:', res.replace('\n', ' | ')[:240])
    check('Rival 2100' in res and 'Racha' in res, 'result: the Level moves and the streak counts')
    page.screenshot(path=f'{SHOTS}/c05-result.png')
    page.locator('.camp-result').get_by_role('button', name='Cerrar').click(); page.wait_for_timeout(600)
    card = page.locator('.camp-card').inner_text()
    check('Completada' in card or 'COMPLETADA' in card, 'card: today\'s Campaign is done')
    check(page.locator('.camp-card').get_by_role('button', name='Empezar la Campaña').count() == 0, 'one a day: no second Campaign')
    page.screenshot(path=f'{SHOTS}/c06-card-done.png', full_page=True)
    page.locator('.tab', has_text='Entrenar').click(); page.wait_for_timeout(600)
    check(page.locator('.camp-pick').count() == 0, 'Entrenar: no reminder once done')
    page.locator('.tab', has_text='Partidas').click(); page.wait_for_timeout(800)
    check('Campaña' in page.locator('.game-list').first.inner_text(), 'the game is in the registry, marked Campaña')
    page.locator('.tab', has_text='Atlas').click(); page.wait_for_timeout(800)
    atlas = page.locator('.camp-atlas').inner_text()
    check('1' in atlas and page.locator('.camp-dot').count() == 1, 'Atlas: the Campaign (streak, Level, latest result)')
    page.screenshot(path=f'{SHOTS}/c07-atlas.png', full_page=True)
    page.locator('.tab', has_text='Ajustes').click(); page.wait_for_timeout(600)
    check(page.locator('.swatch.theme-campana.locked').count() == 1, 'Settings: the Campaign board is locked until 7 days')
    check(page.locator('#show-rank').count() == 1, 'Settings: «Aparecer en los rankings»')

    # Top 3: this account sets a Netero record, then a second account in the same repertoire
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(500)
    page.locator('.nt-scope').first.get_by_role('button', name='Empezar').click(); page.wait_for_timeout(600)
    page.locator('.netero .start-btn').click(); page.wait_for_timeout(300)
    play_netero(page)
    page.wait_for_selector('.nt-report', timeout=20000); page.wait_for_timeout(1200)
    page.locator('.nt-report').get_by_role('button', name='Netero').click(); page.wait_for_timeout(500)
    check(page.locator('.nt-top').count() == 0, 'Top 3: hidden while only one person has a nota')

    ctx2 = new_context(b, 1366, 820)
    ctx2.route('https://lichess.org/oauth*', lichess_as('BeaQA'))
    p2 = ctx2.new_page()
    p2.on('pageerror', lambda e: errors.append(str(e)))
    enter(p2, key, 'Bea')
    sign_in(p2)
    p2.locator('.nt-scope').first.get_by_role('button', name='Empezar').click(); p2.wait_for_timeout(600)
    p2.locator('.netero .start-btn').click(); p2.wait_for_timeout(300)
    play_netero(p2, fail_first=True)
    p2.wait_for_selector('.nt-report', timeout=20000); p2.wait_for_timeout(1200)
    p2.locator('.nt-report').get_by_role('button', name='Netero').click(); p2.wait_for_timeout(500)
    top = p2.locator('.nt-top').first.inner_text() if p2.locator('.nt-top').count() else ''
    check('CampQA' in top and 'BeaQA' in top, f'Top 3: two people, with their notas ({top.replace(chr(10), " ")})')
    p2.screenshot(path=f'{SHOTS}/c08-top3.png', full_page=True)
    # Bea hides from rankings: the Top 3 disappears for the other account
    p2.locator('.tab', has_text='Ajustes').click(); p2.wait_for_timeout(600)
    p2.locator('#show-rank').click(); p2.wait_for_timeout(600)
    page.reload(); page.wait_for_timeout(1500)
    page.locator('.tab', has_text='Netero').click(); page.wait_for_timeout(700)
    check(page.locator('.nt-top').count() == 0, 'Top 3: someone who hides is left out')
    ctx2.close(); ctx.close()

    # phones: the card and the game
    for (w, h, name) in [(390, 844, 'phone'), (844, 390, 'landscape')]:
        c = new_context(b, w, h)
        c.route('https://lichess.org/oauth*', lichess_as(f'Movil{name}'))
        pg = c.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        enter(pg, key, 'Movil')
        sign_in(pg)
        pg.screenshot(path=f'{SHOTS}/c20-{name}-card.png')
        pg.get_by_role('button', name='Empezar la Campaña').click(); pg.wait_for_timeout(600)
        pg.locator('.netero .start-btn').click(); pg.wait_for_timeout(300)
        play_netero(pg)
        pg.wait_for_selector('.nt-report', timeout=20000); pg.wait_for_timeout(500)
        pg.get_by_role('button', name='Jugar la partida').click(); pg.wait_for_timeout(1200)
        pg.locator('.camp-game .start-btn').click(); pg.wait_for_timeout(600)
        play_game(pg, (game(pg)['moveNo'] or 6) + 2)
        pg.screenshot(path=f'{SHOTS}/c21-{name}-game.png')
        vis = pg.evaluate("(() => { const r = document.querySelector('.camp-game .actions').getBoundingClientRect(); const nav = document.querySelector('.tabs'); const fixed = getComputedStyle(nav).position === 'fixed'; return r.bottom <= (fixed ? nav.getBoundingClientRect().top + 1 : innerHeight + 1) && r.height > 0; })()")
        check(vis, f'{name}: the game actions are on screen')
        c.close()
    b.close()

errs = [e for e in errors if 'favicon' not in e]
log('console errors:', errs[:5])
log(f'campaign browser checks: {len(fails)} failed')
sys.exit(1 if fails or errs else 0)
