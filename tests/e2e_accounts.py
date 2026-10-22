# End-to-end check of Lichess accounts, medals and the Atlas.
# Run `DEV_FAKE_LICHESS=1 npm run dev` first; lichess.org is simulated (the code returned is the username).
import sys, json
from urllib.parse import urlparse, parse_qs, urlencode
from playwright.sync_api import sync_playwright
SHOTS = sys.argv[1]
BASE = 'http://localhost:8790'
CATALAN = "d2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 f8e7 g1f3 e8g8 e1g1 d5c4 d1c2 a7a6 a2a4 c8d7 c2c4 d7c6 c1g5 a6a5".split()
errors = []
def log(*a): print(*a, flush=True)

def fake_lichess(route, username='FrancoGasic'):
    q = parse_qs(urlparse(route.request.url).query)
    assert q['response_type'] == ['code'] and q['code_challenge_method'] == ['S256'] and q['client_id'] == ['traynsko'], q
    back = q['redirect_uri'][0] + '?' + urlencode({'code': username, 'state': q['state'][0]})
    route.fulfill(status=302, headers={'Location': back})

def sq(page, s, color='w'):
    box = page.locator('.train cg-board').bounding_box(); w = box['width'] / 8
    f, r = ord(s[0]) - 97, int(s[1])
    if color == 'b': f, r = 7 - f, 9 - r
    return box['x'] + (f + .5) * w, box['y'] + (8 - r + .5) * w

def play_line(page, moves, wrong_first=False):
    if wrong_first:
        page.mouse.click(*sq(page, 'e2')); page.mouse.click(*sq(page, 'e4')); page.wait_for_timeout(400)
    for i in range(0, len(moves), 2):
        page.mouse.click(*sq(page, moves[i][:2])); page.wait_for_timeout(40); page.mouse.click(*sq(page, moves[i][2:4])); page.wait_for_timeout(450)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 820})
    ctx.route('https://lichess.org/oauth*', lambda route: fake_lichess(route))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE); page.wait_for_timeout(1000)
    # master: one world with a White chapter (1 line) and a Black chapter (3 lines)
    page.locator('.master-star').first.click(); page.fill('#master-pass', 'maestro-dev'); page.get_by_role('button', name='Entrar a la Sala').click(); page.wait_for_timeout(600)
    page.get_by_role('button', name='+ Nuevo repertorio').click(); page.wait_for_timeout(200)
    page.fill('#c-name', 'Mundo Prueba'); page.fill('#c-sub', 'Catalana y Benko'); page.fill('#c-pass', 'prueba1')
    page.get_by_role('button', name='Crear repertorio').click(); page.wait_for_timeout(700)
    for f, name, color in [('tests/fixtures/ejemplo.pgn', 'Catalana', 'Blancas'), ('tests/fixtures/benko-negras.pgn', 'Benko Negras', 'Negras')]:
        page.set_input_files('#rep-file', f); page.wait_for_timeout(300)
        page.fill('#rep-name', name); page.locator('#rep-color button', has_text=color).click()
        page.get_by_role('button', name='Añadir a Mundo Prueba').click(); page.wait_for_timeout(700)
    page.get_by_role('button', name='Todos los repertorios').click(); page.wait_for_timeout(300)
    page.get_by_role('button', name='Salir de la Sala').click(); page.wait_for_timeout(700)
    page.screenshot(path=f'{SHOTS}/a01-portal-guest.png')

    # 1) guest plays with one mistake and saves under "Franco"
    page.fill('#key-name', 'Franco'); page.fill('#key-pass', 'prueba1')
    page.screenshot(path=f'{SHOTS}/a02-gate-guest.png')
    page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1300)
    page.locator('.tab', has_text='Biblioteca').click(); page.wait_for_timeout(300)
    page.get_by_role('switch', name='Entrenar Benko Negras').click(); page.wait_for_timeout(300)
    page.locator('.tab', has_text='Entrenar').click(); page.wait_for_timeout(800)
    page.locator('.train .start-btn').click(); page.wait_for_timeout(600)
    play_line(page, CATALAN, wrong_first=True); page.wait_for_timeout(1500)
    page.get_by_role('button', name='Abandonar').click(); page.get_by_role('button', name='Sí, abandonar').click(); page.wait_for_timeout(900)
    log('guest medal note:', page.locator('.medal-note').count())
    page.get_by_role('button', name='Guardar', exact=True).click(); page.wait_for_timeout(700)
    page.get_by_role('button', name='Siguiente línea').first.click(); page.wait_for_timeout(800)
    # perfect run as guest: nudged to sign in
    play_line(page, CATALAN); page.wait_for_timeout(600)
    log('guest banner:', page.locator('.banner').inner_text() if page.locator('.banner').count() else '-')
    page.wait_for_timeout(1200)
    page.get_by_role('button', name='Abandonar').click(); page.get_by_role('button', name='Sí, abandonar').click(); page.wait_for_timeout(900)
    log('guest perfect note:', page.locator('.medal-note').inner_text().replace('\n', ' | '))
    page.screenshot(path=f'{SHOTS}/a03-guest-perfect.png')
    page.get_by_role('button', name='No guardar').click(); page.get_by_role('button', name='Ver tablero').click()
    page.locator('.tab', has_text='Atlas').click(); page.wait_for_timeout(400)
    page.screenshot(path=f'{SHOTS}/a04-atlas-guest.png')

    # 2) sign in from Settings, claim the old games
    page.locator('.tab', has_text='Ajustes').click(); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/a05-settings-guest.png', full_page=True)
    page.locator('.account-cta').get_by_role('button', name='Entrar con Lichess').click(); page.wait_for_timeout(1800)
    log('after login url:', page.url, '| toast:', page.locator('.toast').first.inner_text() if page.locator('.toast').count() else '-')
    page.locator('.tab', has_text='Ajustes').click(); page.wait_for_timeout(300)
    log('claim prefill:', page.locator('#claim-name').input_value())
    page.locator('#claim-name').fill('franco'); page.get_by_role('button', name='Buscar').click(); page.wait_for_timeout(500)
    log('claim preview:', page.locator('.confirm').first.inner_text().replace('\n', ' | '))
    page.screenshot(path=f'{SHOTS}/a06-settings-account.png', full_page=True)
    page.get_by_role('button', name='Pasarla a mi cuenta').click(); page.wait_for_timeout(700)
    log('claim result:', page.locator('.save-msg').first.inner_text())
    page.locator('.tab', has_text='Partidas').click(); page.wait_for_timeout(800)
    log('games tab:', page.locator('.page-head .eyebrow').inner_text(), '|', page.locator('.game').count(), 'games')

    # 3) perfect line from move 1 with account: medal
    page.locator('.tab', has_text='Entrenar').click(); page.wait_for_timeout(500)
    if page.get_by_role('button', name='Siguiente línea').count(): page.get_by_role('button', name='Siguiente línea').first.click(); page.wait_for_timeout(800)
    if page.locator('.train .start-btn').count(): page.locator('.train .start-btn').click(); page.wait_for_timeout(600)
    log('player strip:', page.locator('.player.bottom .player-name').inner_text())
    play_line(page, CATALAN); page.wait_for_timeout(400)
    log('banner:', page.locator('.banner').inner_text() if page.locator('.banner').count() else '-')
    page.screenshot(path=f'{SHOTS}/a07-banner.png')
    page.wait_for_timeout(1500)
    page.get_by_role('button', name='Abandonar').click(); page.get_by_role('button', name='Sí, abandonar').click(); page.wait_for_timeout(1000)
    log('medal note:', page.locator('.medal-note').inner_text().replace('\n', ' | '))
    page.screenshot(path=f'{SHOTS}/a08-endsheet-medal.png')
    page.get_by_role('button', name='Ver Atlas').click(); page.wait_for_timeout(500)
    log('atlas tally:', page.locator('.tally').inner_text().replace('\n', ' '))
    page.screenshot(path=f'{SHOTS}/a09-atlas.png', full_page=True)
    # again: revalidated
    page.locator('.tab', has_text='Entrenar').click(); page.wait_for_timeout(400)
    page.get_by_role('button', name='Siguiente línea').first.click(); page.wait_for_timeout(800)
    play_line(page, CATALAN); page.wait_for_timeout(400)
    log('banner 2:', page.locator('.banner').inner_text() if page.locator('.banner').count() else '-')
    page.wait_for_timeout(1500)
    page.get_by_role('button', name='Abandonar').click(); page.get_by_role('button', name='Sí, abandonar').click(); page.wait_for_timeout(1000)
    log('medal note 2:', page.locator('.medal-note').inner_text().replace('\n', ' | '))
    page.get_by_role('button', name='No guardar').click(); page.get_by_role('button', name='Ver tablero').click()

    # 4) phone: portal signed in, door, Atlas
    state = ctx.storage_state()
    m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, storage_state=state)
    m.route('https://lichess.org/oauth*', lambda route: fake_lichess(route))
    mp = m.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
    mp.goto(BASE + '/#atlas'); mp.wait_for_timeout(1500)
    mp.screenshot(path=f'{SHOTS}/m01-atlas.png', full_page=True)
    log('mobile scrollWidth', mp.evaluate('document.documentElement.scrollWidth'))
    mp.locator('.tab', has_text='Ajustes').click(); mp.wait_for_timeout(300)
    mp.get_by_role('button', name='Cambiar de repertorio').click(); mp.wait_for_timeout(900)
    mp.screenshot(path=f'{SHOTS}/m02-portal-signed.png')
    log('cover over the repertoire:', mp.locator('.portal-layer').count(), '| cards:', mp.locator('.portal-layer .wc-name').all_inner_texts())
    mp.locator('.portal-layer .world-card', has_text='Mundo Prueba').click(); mp.wait_for_timeout(600)
    log('card continues the open repertoire:', mp.locator('.portal-layer').count() == 0)
    # forget it, sign out and come back with the key: the door is the key form
    mp.locator('.topbar .brand').click(); mp.wait_for_timeout(400)
    mp.locator('.portal-layer li.known', has_text='Mundo Prueba').locator('.wc-forget').click(); mp.locator('.wc-confirm button', has_text='Quitar').click(); mp.wait_for_timeout(500)
    mp.locator('.account-bar').get_by_role('button', name='Salir').click(); mp.wait_for_timeout(300)
    mp.screenshot(path=f'{SHOTS}/m04-gate-guest.png')
    mp.locator('.account-bar').get_by_role('button', name='Entrar con Lichess').click(); mp.wait_for_timeout(1800)
    log('back from Lichess on the cover, signed in:', mp.locator('.account-bar.signed').count() == 1, '| key form for the account:', 'Jugarás como' in mp.locator('.key-form').inner_text())

    # 5) account deletion
    page.locator('.tab', has_text='Ajustes').click(); page.wait_for_timeout(300)
    page.get_by_role('button', name='Borrar mi cuenta').click(); page.get_by_role('button', name='Sí, borrar').click(); page.wait_for_timeout(900)
    log('after delete:', page.locator('.toast').last.inner_text(), '| cta:', page.locator('.account-cta').count())
    b.close()
log('errors:', json.dumps(errors[:12], ensure_ascii=False))
