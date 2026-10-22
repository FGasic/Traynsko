# Draws against the bot: the player's offer and the bot's own offer in a dead rook ending.
# Run `npm run dev` first (fresh data). Needs Node (tests/safe_move.mjs picks the player's quiet moves).
import sys, json, subprocess
from playwright.sync_api import sync_playwright
SHOTS = sys.argv[1]
BASE = 'http://localhost:8790'
LINE = ['a1a7', 'a7a6']   # the player's moves of the line (White); the book plays ...Kf6
errors = []
def log(*a): print(*a, flush=True)

def sq(page, s):
    box = page.locator('.train cg-board').bounding_box(); w = box['width'] / 8
    return box['x'] + (ord(s[0]) - 97 + .5) * w, box['y'] + (8 - int(s[1]) + .5) * w

def move(page, uci):
    page.mouse.click(*sq(page, uci[:2])); page.wait_for_timeout(40); page.mouse.click(*sq(page, uci[2:4]))

def fen(page): return page.evaluate('window.__traynskoFen()')

def wait_user_turn(page, timeout=15000):
    page.wait_for_function("() => { const f = window.__traynskoFen(); return f && f.split(' ')[1] === 'w'; }", timeout=timeout)

def play_line(page):
    for u in LINE:
        wait_user_turn(page); move(page, u); page.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1366, 'height': 820})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE); page.wait_for_timeout(800)
    page.evaluate("localStorage.setItem('traynsko:settings', JSON.stringify({v: 2, botMoveSec: 1, baseMin: 10, incSec: 5}))")
    page.locator('.master-star').first.click(); page.fill('#master-pass', 'maestro-dev'); page.get_by_role('button', name='Entrar a la Sala').click(); page.wait_for_timeout(600)
    page.get_by_role('button', name='+ Nuevo repertorio').click(); page.wait_for_timeout(200)
    page.fill('#c-name', 'Finales'); page.fill('#c-pass', 'finales1')
    page.get_by_role('button', name='Crear repertorio').click(); page.wait_for_timeout(700)
    page.set_input_files('#rep-file', 'tests/fixtures/final-torres.pgn'); page.wait_for_timeout(300)
    page.fill('#rep-name', 'Torres'); page.locator('#rep-color button', has_text='Blancas').click()
    page.get_by_role('button', name='Añadir a Finales').click(); page.wait_for_timeout(700)
    page.get_by_role('button', name='Todos los repertorios').click(); page.wait_for_timeout(300)
    page.get_by_role('button', name='Salir de la Sala').click(); page.wait_for_timeout(600)
    page.fill('#key-name', 'Prueba'); page.fill('#key-pass', 'finales1'); page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click()
    page.wait_for_timeout(2500)
    page.locator('.train .start-btn').click(); page.wait_for_timeout(700)

    # A) the player offers a draw in an equal rook ending: accepted at once
    play_line(page)
    wait_user_turn(page)
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(500)
    page.screenshot(path=f'{SHOTS}/d00-bot-phase-phone.png')
    page.set_viewport_size({'width': 1366, 'height': 820}); page.wait_for_timeout(500)
    log('A: draw button enabled:', page.get_by_role('button', name='Ofrecer tablas').is_enabled())
    page.screenshot(path=f'{SHOTS}/d01-before-offer.png')
    page.get_by_role('button', name='Ofrecer tablas').click(); page.wait_for_timeout(1200)
    log('A: result:', page.locator('.sheet-result').inner_text().replace('\n', ' | ') if page.locator('.sheet-result').count() else 'NO SHEET')
    page.screenshot(path=f'{SHOTS}/d02-agreed.png')
    page.get_by_role('button', name='No guardar').click()
    page.get_by_role('button', name='Siguiente línea').first.click(); page.wait_for_timeout(1500)

    # B) keep shuffling: the bot should propose the draw itself
    play_line(page)
    seen, offered = [], False
    for i in range(40):
        try: wait_user_turn(page, 20000)
        except Exception: break
        page.wait_for_timeout(250)
        if page.locator('.draw-offer').count():
            offered = True
            log(f'B: bot offered after {i} player moves | banner:', page.locator('.banner').inner_text() if page.locator('.banner').count() else '-')
            page.screenshot(path=f'{SHOTS}/d03-bot-offer.png')
            page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(500)
            page.screenshot(path=f'{SHOTS}/d04-bot-offer-phone.png')
            log('B: phone scrollWidth', page.evaluate('document.documentElement.scrollWidth'))
            page.set_viewport_size({'width': 1366, 'height': 820}); page.wait_for_timeout(500)
            page.locator('.draw-offer').get_by_role('button', name='Aceptar').click(); page.wait_for_timeout(1000)
            log('B: result:', page.locator('.sheet-result').inner_text().replace('\n', ' | '))
            break
        if page.locator('.sheet-result').count():
            log('B: game ended first:', page.locator('.sheet-result').inner_text().replace('\n', ' | ')); break
        out = subprocess.run(['node', 'tests/safe_move.mjs', fen(page), '|'.join(seen)], capture_output=True, text=True).stdout.strip()
        if out == 'none': log('B: no safe move'); break
        uci, k = out.split(' ', 1); seen.append(k)
        move(page, uci); page.wait_for_timeout(400)
    log('B: offered:', offered)

    b.close()
log('errors:', json.dumps(errors[:8], ensure_ascii=False))
