"""Trayner QA: the human-style bot plays by default, its network loads in the background and answers every move,
thinking time follows the position, old settings move to Trayner, the Bots page explains it, and when the network
can't load the bot still plays (Stockfish). Run against the dev server (npm run dev). Exit code 1 on failure."""
import json, random, sys
import chess
from playwright.sync_api import sync_playwright
from qa_util import make_world, new_key, new_context, enter_with_key, begin, play, BASE

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
FEN = "() => window.__traynskoFen ? window.__traynskoFen() : null"
BOT = "() => window.__traynskoBot ? window.__traynskoBot() : null"
ok = True


def expect(cond, label):
    global ok
    print(('OK   ' if cond else 'FAIL ') + label, flush=True)
    ok &= bool(cond)


def seed(ctx, settings):
    ctx.add_init_script(f"try {{ if (!localStorage.getItem('traynsko:seeded')) {{ localStorage.setItem('traynsko:settings', {json.dumps(json.dumps(settings))}); localStorage.setItem('traynsko:seeded', '1'); }} }} catch (e) {{}}")


def wait_turn(page, color, timeout=25000):
    """Wait until it is `color`'s turn (the bot has moved) and return the FEN."""
    page.wait_for_function(f"() => {{ const f = window.__traynskoFen && window.__traynskoFen(); return f && f.split(' ')[1] === '{color}'; }}", timeout=timeout)
    return page.evaluate(FEN)


def play_some(page, moves, rng):
    """Play `moves` user moves (White) with random legal moves; return the bot's traces."""
    traces = []
    for _ in range(moves):
        fen = wait_turn(page, 'w')
        board = chess.Board(fen)
        if board.is_game_over():
            break
        legal = [m.uci() for m in board.legal_moves if not m.promotion]
        play(page, rng.choice(legal), wait=150)
        try:
            wait_turn(page, 'w', 30000)
        except Exception:
            if chess.Board(page.evaluate(FEN)).is_game_over() or page.locator('.sheet-result').count():
                break
            raise
        traces.append(page.evaluate(BOT)['last'])
    return traces


def main():
    key = new_key('trayner')
    make_world('Trayner ' + key[-4:].upper(), key, [('Abierta', 'w', [('t1', 'e2e4 e7e5')])], hue=40)
    rng = random.Random(4)
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---------- default: Trayner, network loads, every move is human-style ----------
        ctx = new_context(b, 1280, 860)
        seed(ctx, {'v': 3, 'botMoveSec': 1, 'baseMin': 10, 'incSec': 5})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        model_hits = []
        page.on('request', lambda r: model_hits.append(r.url) if '/maia/' in r.url or '/ort/' in r.url else None)
        enter_with_key(page, key, name='Humano')
        page.wait_for_timeout(2500)
        expect(any('/maia/' in u for u in model_hits) and any('/ort/' in u for u in model_hits), 'the network and its runtime load in the background')
        begin(page)
        play(page, 'e2e4', wait=1500)
        expect(page.evaluate(BOT)['id'] == 'trayner', 'the bot after the line is Trayner')
        traces = play_some(page, 10, rng)
        hows = [t['how'] for t in traces]
        over = chess.Board(page.evaluate(FEN)).is_game_over()
        expect((len(traces) >= 8 or (over and len(traces) >= 4)) and all(h in ('human', 'mate') for h in hows), f'every bot move chosen the human way: {hows}{" (game over)" if over else ""}')
        thinks = [t['thinkMs'] for t in traces]
        expect(max(thinks) > 1.6 * min(thinks), f'thinking time varies with the position: {thinks}')
        tops = [round(t.get('top') or 0, 2) for t in traces]
        print('     network confidence per move:', tops)
        maia_ms = [t.get('maiaMs', 0) for t in traces]
        expect(max(maia_ms) < 1500, f'network answers fast: {maia_ms} ms')
        expect('Trayner' in page.locator('.player.top').inner_text(), 'its name shows on the board')
        page.screenshot(path=f'{SHOTS}/t01-game.png')

        # Bots page
        page.locator('.tabs .tab', has_text='Bots').first.click(); page.wait_for_timeout(900)
        cards = page.locator('.bot-card')
        expect(cards.first.locator('.bot-name').inner_text() == 'Trayner', 'Trayner is first in Bots')
        on = [c.locator('.bot-name').inner_text() for c in cards.all() if 'off' not in (c.get_attribute('class') or '')]
        expect(on == ['Trayner'], f'only Trayner on by default: {on}')
        expect('listo' in cards.first.locator('.maia-state').inner_text().lower(), 'the card says the model is ready')
        expect(cards.first.locator('.bot-credit a').count() == 2, 'credit with links to Maia-3 and the app’s code')
        page.screenshot(path=f'{SHOTS}/t02-bots.png', full_page=True)
        expect(not errs, f'no page errors {errs[:3]}')
        ctx.close()

        # ---------- old settings (other bots chosen) move to Trayner once ----------
        ctx = new_context(b, 390, 844)
        seed(ctx, {'v': 2, 'botMoveSec': 1, 'enabledBots': ['tormenta', 'notario'], 'elo': 2100})
        page = ctx.new_page()
        enter_with_key(page, key, name='Antiguo')
        st = json.loads(page.evaluate("localStorage.getItem('traynsko:settings')"))
        expect(st['enabledBots'] == ['trayner'] and st['v'] == 3 and st['elo'] == 2100, f'old settings: Trayner on, the rest kept ({st["enabledBots"]}, {st["elo"]})')
        page.locator('.tabs .tab', has_text='Bots').first.click(); page.wait_for_timeout(700)
        page.locator('#bot-tormenta').click(); page.wait_for_timeout(200)
        page.reload(); page.wait_for_selector('.tabs .tab'); page.wait_for_timeout(800)
        st = json.loads(page.evaluate("localStorage.getItem('traynsko:settings')"))
        expect(st['enabledBots'] == ['trayner', 'tormenta'], f'switching another bot back on sticks ({st["enabledBots"]})')
        page.locator('.tabs .tab', has_text='Bots').first.click(); page.wait_for_timeout(700)
        over = page.evaluate("() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.bot-card')].some((c) => c.scrollWidth > c.clientWidth + 1)")
        expect(not over, '390px: Bots page fits')
        page.locator('.bot-card').first.scroll_into_view_if_needed()
        page.screenshot(path=f'{SHOTS}/t03-bots-phone.png')
        ctx.close()

        # ---------- the network can't load: the bot still plays ----------
        ctx = new_context(b, 1280, 860)
        seed(ctx, {'v': 3, 'botMoveSec': 1})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.route('**/maia/**', lambda route: route.abort())
        enter_with_key(page, key, name='SinRed')
        page.wait_for_timeout(2500)
        begin(page)
        play(page, 'e2e4', wait=1500)
        traces = play_some(page, 3, rng)
        expect(len(traces) == 3 and all(t['how'] in ('engine', 'fallback') for t in traces), f'without the network, Stockfish plays: {[t["how"] for t in traces]}')
        page.locator('.tabs .tab', has_text='Bots').first.click(); page.wait_for_timeout(900)
        expect('no pudo' in page.locator('.bot-card').first.locator('.maia-state').inner_text().lower(), 'the card says the model could not load')
        expect(not errs, f'no page errors {errs[:3]}')
        ctx.close()
        b.close()
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
