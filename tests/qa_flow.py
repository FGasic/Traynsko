"""Flow QA: the board waits for «Comenzar partida», the gear options, playing the opposite colour,
no stray selection between games, the cover, the Biblioteca, leaving a game, keys that open several repertoires.
Run against the dev server (npm run dev). Exit code 1 on failure."""
import sys, re
from playwright.sync_api import sync_playwright
from qa_util import api, make_world, new_key, new_context, enter_with_key, begin, play, BASE

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
LINE = "d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6".split()      # Benko, repertoire = black
OTHER = "e2e4 c7c5 g1f3 d7d6".split()                        # a white chapter elsewhere
SEL = "() => document.querySelectorAll('.train cg-board square.selected, .train cg-board square.move-dest, .train cg-board square.current-premove').length"
FEN = "() => window.__traynskoFen ? window.__traynskoFen() : null"
ok = True


def expect(cond, label):
    global ok
    print(('OK   ' if cond else 'FAIL ') + label, flush=True)
    ok &= bool(cond)


def clocks(page):
    return page.locator('.train .clock').all_inner_texts()


def pill(page):
    return page.locator('.train .status-card .pill').first.inner_text().strip().lower()


def main():
    key_a, key_b, key_c = new_key('benko'), new_key('sici'), new_key('doble')
    tag = key_a[-4:].upper()   # names unique to this run (the dev server keeps earlier runs' data)
    A, B, C1, C2 = f'Benko {tag}', f'Siciliana {tag}', f'Doble Uno {tag}', f'Doble Dos {tag}'
    wa = make_world(A, key_a, [('Benko Principal', 'b', [('b1', ' '.join(LINE))])], hue=30)
    make_world(B, key_b, [('Siciliana', 'w', [('s1', ' '.join(OTHER))])], hue=140)
    make_world(C1, key_c, [('Uno', 'w', [('d1', ' '.join(OTHER))])], hue=280)
    make_world(C2, key_c, [('Dos', 'w', [('d2', ' '.join(OTHER))])], hue=320)

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = new_context(b, 390, 760)
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        tap = lambda uci, wait=800: play(page, uci, wait, touch=True)

        # ---------- cover without anything opened: no catalogue, just the key ----------
        page.goto(BASE); page.wait_for_timeout(800)
        expect(page.locator('.world-card').count() == 0, 'first visit: the cover lists no repertoires')
        expect(page.locator('#key-pass').count() == 1, 'first visit: the key form is there')
        page.fill('#key-name', 'Ana'); page.fill('#key-pass', 'no-existe'); page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(500)
        expect('ningún' in (page.locator('.key-form .form-error').inner_text() if page.locator('.key-form .form-error').count() else ''), 'wrong key: clear message')
        page.screenshot(path=f'{SHOTS}/f01-cover-first.png')
        enter_with_key(page, key_a, name='Ana', goto=False)

        # ---------- the board waits ----------
        expect(page.locator('.train .ready-layer').count() == 1, 'opening a repertoire: the board waits for «Comenzar partida»')
        tabs = [t.strip().lower() for t in page.locator('.tabs .tab span').all_inner_texts()]
        expect(tabs[:3] == ['entrenar', 'partidas', 'biblioteca'], f'tab order {tabs}')
        c0, f0 = clocks(page), page.evaluate(FEN)
        page.wait_for_timeout(2500)
        expect(clocks(page) == c0 and page.evaluate(FEN) == f0, 'nothing moves and no clock runs before starting')
        expect('(2300)' in page.locator('.player.top').inner_text(), 'rival strip shows the Elo in parentheses')
        expect(page.locator('.train .player .avatar, .train .player .me-badge').count() == 0, 'no avatar squares in the strips')
        expect(page.locator('.train .status-card .tc').inner_text().strip() == '10+5', 'time control sits in the status bar')
        page.screenshot(path=f'{SHOTS}/f02-ready.png')

        # ---------- gear: Elo, colour, time ----------
        page.locator('.train .gear-btn').click(); page.wait_for_timeout(300)
        expect(page.locator('.game-opts').count() == 1, 'gear opens the options')
        page.evaluate("() => { const r = document.querySelector('#go-elo'); r.value = '2000'; r.dispatchEvent(new Event('input', { bubbles: true })); }")
        page.locator('.color-pick button', has_text='contrario').click()
        page.locator('.game-opts .chip', has_text='5+3').click(); page.wait_for_timeout(400)
        page.screenshot(path=f'{SHOTS}/f03-options.png')
        page.locator('.game-opts .icon-btn[aria-label="Cerrar"]').click(); page.wait_for_timeout(300)
        white = page.evaluate("() => document.querySelector('.train .cg-wrap').classList.contains('orientation-white')")
        expect(white, 'opposite colour: the board turns to white before starting')
        expect('blancas' in page.locator('.ready-sub').inner_text().lower(), 'the start card says the colour')
        expect('(2000)' in page.locator('.player.top').inner_text(), 'new Elo shown at once')
        expect(page.locator('.train .tc').inner_text().strip() == '5+3' and clocks(page)[0].startswith('5:00'), 'new time control applied before starting')

        # ---------- opposite colour: the user plays the line's replies ----------
        begin(page)
        expect(page.locator('.train .ready-layer').count() == 0 and page.locator('.train .gear-btn').count() == 0, 'gear and start button gone once the game starts')
        for i in range(0, len(LINE), 2):
            tap(LINE[i], 1100)
        page.wait_for_timeout(1500)
        expect('partida' in pill(page), 'opposite colour: the line is done and the game against the bot began')
        # a piece selected during the game, then resign: nothing stays selected
        own = page.evaluate("() => { const c = document.querySelector('.train cg-board'); return [...c.querySelectorAll('piece.white')].map(p => p.cgKey).find(k => k && k[1] === '2'); }")
        page.wait_for_timeout(3500)
        page.touchscreen.tap(*__import__('qa_util').square_xy(page, own)); page.wait_for_timeout(200)
        page.locator('.train .actions button', has_text='Abandonar').click(); page.locator('.train button', has_text='Sí, abandonar').click(); page.wait_for_timeout(900)
        expect(page.evaluate(SEL) == 0, 'after resigning: no selected square on the final position')
        expect(page.locator('.medal-note').count() == 0, 'opposite colour: no emblem note')
        page.locator('.sheet button', has_text='No guardar').click()
        page.locator('.sheet button', has_text='Siguiente línea').click(); page.wait_for_timeout(1200)
        expect(page.locator('.train .ready-layer').count() == 0, '«Siguiente línea» starts the next game at once')
        expect(page.evaluate(SEL) == 0, 'next line after a selection: no stray yellow square')

        # back to the repertoire colour (Ajustes applies to the next line)
        page.locator('.tab', has_text='Ajustes').click(); page.wait_for_timeout(300)
        page.locator('#color-mode button', has_text='El del repertorio').click(); page.wait_for_timeout(200)
        page.locator('.tab', has_text='Entrenar').click(); page.wait_for_timeout(500)
        page.locator('.train .actions button', has_text='Otra línea').click(); page.wait_for_timeout(1500)
        black = page.evaluate("() => document.querySelector('.train .cg-wrap').classList.contains('orientation-black')")
        expect(black, 'repertorio colour again: black')

        # ---------- the reported glitch: select a piece, then «Otra línea» ----------
        page.wait_for_timeout(600)
        page.touchscreen.tap(*__import__('qa_util').square_xy(page, 'g8')); page.wait_for_timeout(200)
        expect(page.evaluate(SEL) > 0, 'a tapped piece is selected')
        page.locator('.train .actions button', has_text='Otra línea').click(); page.wait_for_timeout(1500)
        expect(page.evaluate(SEL) == 0, '«Otra línea» after selecting a piece: no stray yellow square')
        page.screenshot(path=f'{SHOTS}/f04-clean-new-line.png')

        # ---------- a game in progress, the cover over it ----------
        for i in range(1, len(LINE), 2):
            tap(LINE[i], 1000)
        page.wait_for_timeout(1500)
        expect('partida' in pill(page), 'game against the bot in progress')
        page.locator('.topbar .brand').click(); page.wait_for_timeout(500)
        expect(page.locator('.portal-layer').count() == 1, 'the title opens the cover')
        expect(page.locator('.portal-layer .world-card').count() == 1 and 'continuar' in page.locator('.portal-layer .world-card').first.inner_text().lower(), 'the cover shows the repertoire already opened')
        page.screenshot(path=f'{SHOTS}/f05-cover-over-game.png')
        page.locator('.portal-back').click(); page.wait_for_timeout(500)
        expect(page.locator('.portal-layer').count() == 0 and 'partida' in pill(page), 'back from the cover: the game is still there')

        # ---------- Biblioteca: every repertoire; switching asks first ----------
        page.locator('.tab', has_text='Biblioteca').click(); page.wait_for_timeout(800)
        names = page.locator('.lib-card .lc-name').all_inner_texts()
        expect(B in names and A not in names, f'Biblioteca lists the others: {names}')
        expect(page.locator('.lib-current .rep').count() == 1, 'Biblioteca shows the chapters of the open repertoire')
        page.screenshot(path=f'{SHOTS}/f06-library.png', full_page=True)
        page.locator('.lib-card', has_text=B).click(); page.wait_for_timeout(300)
        page.fill('#gate-pass', key_b); page.locator('.sheet').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(700)
        expect(page.locator('.confirm-sheet').count() == 1, 'leaving a game in progress asks first')
        page.screenshot(path=f'{SHOTS}/f07-leave-confirm.png')
        page.locator('.confirm-sheet button', has_text='Volver a la partida').click(); page.wait_for_timeout(500)
        expect(A.lower() in page.locator('.world-badge').inner_text().lower() and 'partida' in pill(page), '«Volver a la partida» keeps the game')
        page.locator('.tab', has_text='Biblioteca').click(); page.wait_for_timeout(800)
        page.locator('.lib-card', has_text=B).click(); page.wait_for_timeout(300)
        page.fill('#gate-pass', key_b); page.locator('.sheet').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(700)
        page.locator('.confirm-sheet .btn.primary').click(); page.wait_for_timeout(1500)
        expect(B.lower() in page.locator('.world-badge').inner_text().lower(), 'confirmed: the other repertoire is open')
        expect(page.locator('.train .ready-layer').count() == 1, 'and its board waits to start')
        page.locator('.topbar .brand').click(); page.wait_for_timeout(500)
        cards = [x.lower() for x in page.locator('.portal-layer .wc-name').all_inner_texts()]
        expect(cards == [B.lower(), A.lower()], f'cover: both, most recent first {cards}')
        page.locator('.portal-layer .world-card', has_text=A).click(); page.wait_for_timeout(1500)
        expect(A.lower() in page.locator('.world-badge').inner_text().lower(), 'cover card opens the repertoire directly (no key)')

        # ---------- the key changes: the card asks for the new one ----------
        t = api('POST', 'admin/login', {'password': 'maestro-dev'})['token']
        new_a = new_key('benko2')
        api('PATCH', f"admin/worlds/{wa['id']}", {'password': new_a}, t)
        page.locator('.tab', has_text='Partidas').click(); page.wait_for_timeout(1500)
        expect(page.locator('#gate-pass').count() == 1, 'old key rejected: asks for the new one')
        page.fill('#gate-pass', new_a); page.locator('.sheet').get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1500)
        expect(A.lower() in page.locator('.world-badge').inner_text().lower(), 'new key: back in')

        # ---------- forget a repertoire on this device ----------
        page.locator('.topbar .brand').click(); page.wait_for_timeout(500)
        page.locator('.portal-layer li.known', has_text=B).locator('.wc-forget').click()
        page.locator('.wc-confirm button', has_text='Quitar').click(); page.wait_for_timeout(300)
        expect([x.lower() for x in page.locator('.portal-layer .wc-name').all_inner_texts()] == [A.lower()], 'forgotten repertoire leaves the cover')
        if errs: print('page errors', errs[:3]); expect(False, 'no page errors')
        ctx.close()

        # ---------- one key, two repertoires ----------
        ctx = new_context(b, 1280, 800)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errs.append(str(e)))
        enter_with_key(page, key_c, name='Luis')
        toast = page.locator('.toast').first.inner_text() if page.locator('.toast').count() else ''
        expect('2 repertorios' in toast, f'a key that opens two repertoires says so: {toast!r}')
        page.locator('.topbar .brand').click(); page.wait_for_timeout(600)
        expect(sorted(x.lower() for x in page.locator('.portal-layer .wc-name').all_inner_texts()) == sorted([C1.lower(), C2.lower()]), 'both are on the cover')
        page.screenshot(path=f'{SHOTS}/f08-cover-desktop.png')
        page.locator('.portal-back').click(); page.wait_for_timeout(300)
        page.locator('.tab', has_text='Biblioteca').click(); page.wait_for_timeout(800)
        page.screenshot(path=f'{SHOTS}/f09-library-desktop.png', full_page=True)
        if errs: print('page errors', errs[:3]); expect(False, 'no page errors')
        b.close()
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
