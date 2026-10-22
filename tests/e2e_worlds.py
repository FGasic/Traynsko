import sys, time, json
from playwright.sync_api import sync_playwright
SHOTS = sys.argv[1]
BASE = 'http://localhost:8790'
PGN = 'tests/fixtures/ejemplo.pgn'
LINE = "d2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 f8e7 g1f3 e8g8 e1g1 d5c4 d1c2 a7a6 a2a4 c8d7 c2c4 d7c6 c1g5 a6a5".split()
errors = []
def log(*a): print(*a, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 820})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE); page.wait_for_timeout(1200)
    page.screenshot(path=f'{SHOTS}/w01-portal-empty.png')
    # master
    page.locator('.master-star').first.click(); page.wait_for_timeout(200)
    page.fill('#master-pass', 'mala'); page.get_by_role('button', name='Entrar a la Sala').click(); page.wait_for_timeout(400)
    log('bad master ->', page.locator('.form-error').inner_text())
    page.fill('#master-pass', 'maestro-dev'); page.get_by_role('button', name='Entrar a la Sala').click(); page.wait_for_timeout(600)
    for name, sub, pw, em, hue_idx in [('Benko Gambit', 'Gambito Benko con negras', 'benko2026', 'Peón', 4), ('Catalana', 'Apertura Catalana con blancas', 'cat123', 'Torre', 0), ('Mesa 1', 'Repertorio de la mesa 1', 'mi2026', 'Caballo', 1)]:
        page.get_by_role('button', name='+ Nuevo repertorio').click(); page.wait_for_timeout(200)
        page.fill('#c-name', name); page.fill('#c-sub', sub); page.fill('#c-pass', pw)
        page.locator('.sheet .emblem-opt[aria-label="%s"]' % em).click()
        page.locator('.sheet .hue-opt').nth(hue_idx).click()
        if name == 'Benko Gambit': page.screenshot(path=f'{SHOTS}/w02-create.png')
        page.get_by_role('button', name='Crear repertorio').click(); page.wait_for_timeout(700)
        if name == 'Benko Gambit':
            page.set_input_files('#rep-file', PGN); page.wait_for_timeout(300)
            page.fill('#rep-name', 'Benko Trayn 1'); page.locator('#rep-color button', has_text='Blancas').click()
            page.get_by_role('button', name='Añadir a Benko Gambit').click(); page.wait_for_timeout(700)
            page.screenshot(path=f'{SHOTS}/w03-editor.png', full_page=True)
        page.get_by_role('button', name='Todos los repertorios').click(); page.wait_for_timeout(500)
    page.screenshot(path=f'{SHOTS}/w04-room-list.png')
    page.get_by_role('button', name='Salir de la Sala').click(); page.wait_for_timeout(800)
    page.screenshot(path=f'{SHOTS}/w05-portal.png')
    # student enters
    log('portal lists repertoires (should be 0):', page.locator('.world-card').count())
    page.fill('#key-name', 'Ana Pérez'); page.fill('#key-pass', 'mal'); page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(400)
    log('bad world pw ->', page.locator('.form-error').inner_text())
    page.fill('#key-pass', 'BENKO2026'); page.screenshot(path=f'{SHOTS}/w06-gate.png')
    page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1500)
    page.screenshot(path=f'{SHOTS}/w07-train.png')
    page.locator('.train .start-btn').click(); page.wait_for_timeout(600)
    def sq(s):
        box = page.locator('.train cg-board').bounding_box(); w = box['width']/8
        return box['x'] + (ord(s[0])-97+.5)*w, box['y'] + (8-int(s[1])+.5)*w
    page.mouse.click(*sq('e2')); page.mouse.click(*sq('e4')); page.wait_for_timeout(400)
    for i in range(0, len(LINE), 2):
        page.mouse.click(*sq(LINE[i][:2])); page.wait_for_timeout(40); page.mouse.click(*sq(LINE[i][2:4])); page.wait_for_timeout(430)
    page.wait_for_timeout(4500)
    page.screenshot(path=f'{SHOTS}/w08-bot.png')
    log('phase:', page.locator('.status-head .pill').inner_text())
    page.get_by_role('button', name='Abandonar').click(); page.get_by_role('button', name='Sí, abandonar').click(); page.wait_for_timeout(900)
    page.get_by_role('button', name='Guardar', exact=True).click(); page.wait_for_timeout(800)
    log('save:', page.locator('.save-ask').inner_text().replace('\n', ' | '))
    page.screenshot(path=f'{SHOTS}/w09-saved.png')
    page.get_by_role('button', name='Ver en Partidas').click(); page.wait_for_timeout(800)
    page.screenshot(path=f'{SHOTS}/w10-games.png')
    page.locator('.game').first.click(); page.wait_for_timeout(900)
    page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowLeft'); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/w11-viewer.png')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    # master sees the student, changes the password
    page.locator('.tab', has_text='Ajustes').click(); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/w12-settings.png', full_page=True)
    page.locator('.master-star').click(); page.wait_for_timeout(700)
    page.locator('.aw-main', has_text='Benko Gambit').click(); page.wait_for_timeout(800)
    log('students:', page.locator('.students tbody').inner_text().replace('\n', ' | ').replace('\t', ' '))
    page.screenshot(path=f'{SHOTS}/w13-editor-students.png', full_page=True)
    page.get_by_role('button', name='Cambiar clave').click(); page.fill('#new-pass', 'benko-pago'); page.get_by_role('button', name='Guardar clave').click(); page.wait_for_timeout(700)
    log('key now:', page.locator('.key').inner_text())
    page.get_by_role('button', name='Todos los repertorios').click(); page.wait_for_timeout(300)
    page.get_by_role('button', name='Salir de la Sala').click(); page.wait_for_timeout(500)
    # student's session is now stale: next request kicks out
    page.locator('.tab', has_text='Partidas').click(); page.wait_for_timeout(1200)
    log('after pw change:', page.locator('.gate-body .notice').inner_text() if page.locator('.gate-body .notice').count() else 'NO NOTICE', '| gate open:', page.locator('#gate-pass').count())
    page.screenshot(path=f'{SHOTS}/w14-kicked.png')
    page.fill('#gate-pass', 'benko-pago'); page.locator('.sheet').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1200)
    log('re-entered:', page.locator('.world-badge').inner_text())
    # mobile portal & train & viewer
    m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    mp = m.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
    mp.goto(BASE); mp.wait_for_timeout(1200)
    mp.screenshot(path=f'{SHOTS}/m01-portal.png')
    mp.fill('#key-name', 'Luis'); mp.fill('#key-pass', 'benko-pago')
    mp.screenshot(path=f'{SHOTS}/m02-gate.png')
    mp.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); mp.wait_for_timeout(1500)
    mp.screenshot(path=f'{SHOTS}/m03-train.png')
    log('mobile scrollWidth', mp.evaluate('document.documentElement.scrollWidth'))
    b.close()
log('errors:', json.dumps(errors[:12], ensure_ascii=False))
