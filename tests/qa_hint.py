"""Hint arrow QA: the green arrow must disappear as soon as the position changes, a new line starts or the game moves on.
Run against the dev server (npm run dev). Exit code 1 on failure."""
import sys, json, random, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8790'
LINE = "d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6".split()   # user = black, short line so the bot phase starts quickly


def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + '/api/' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'x-test-ip': f'10.9.{random.randint(0, 255)}.{random.randint(1, 254)}', **({'Authorization': 'Bearer ' + token} if token else {})})
    return json.loads(urllib.request.urlopen(req).read())


def setup():
    t = api('POST', 'admin/login', {'password': 'maestro-dev'})['token']
    w = api('POST', 'admin/worlds', {'name': 'Pistas QA', 'subtitle': 'Negras', 'password': 'pista1', 'emblem': 'pawn', 'hue': 200}, t)['world']
    api('POST', f"admin/worlds/{w['id']}/reps", {'name': 'Benko corto', 'color': 'b', 'lines': [
        {'id': 'h1', 'event': 'Benko', 'white': 'Corta', 'black': 'QA', 'uci': ' '.join(LINE)}]}, t)
    return w


ARROWS = "() => document.querySelectorAll('.train cg-container svg.cg-shapes line').length"


def main():
    setup()
    ok = True

    def expect(cond, label):
        nonlocal ok
        print(('OK   ' if cond else 'FAIL ') + label, flush=True)
        ok &= bool(cond)

    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, vp, mobile in [('desktop', {'width': 1366, 'height': 800}, False), ('phone', {'width': 360, 'height': 640}, True)]:
            ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
            ctx.set_extra_http_headers({'x-test-ip': f'10.8.{random.randint(0, 255)}.{random.randint(1, 254)}'})  # dev server rate-limits per IP
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE); page.wait_for_timeout(800)
            page.locator('.world-card', has_text='Pistas QA').first.click()
            page.fill('#gate-name', 'QA'); page.fill('#gate-pass', 'pista1')
            page.get_by_role('button', name='Entrar', exact=True).click(); page.wait_for_timeout(1600)

            def sq(s):
                box = page.locator('.train cg-board').bounding_box(); u = box['width'] / 8
                return box['x'] + (7 - (ord(s[0]) - 97) + .5) * u, box['y'] + (int(s[1]) - 1 + .5) * u

            def play(uci, wait=700):
                page.mouse.click(*sq(uci[:2])); page.wait_for_timeout(60); page.mouse.click(*sq(uci[2:4])); page.wait_for_timeout(wait)

            def ask_hint():
                for _ in range(3): play('e7e6', 450)          # legal but wrong
                page.locator('.train button', has_text='Ver').first.click(); page.wait_for_timeout(300)

            arrows = lambda: page.evaluate(ARROWS)

            # 1. hint, then a wrong move: the arrow stays (the help is still valid)
            ask_hint()
            expect(arrows() > 0, f'{name}: hint arrow shown')
            play('e7e6', 600)
            expect(arrows() > 0, f'{name}: hint arrow still shown after another wrong try')
            # 2. playing the move removes it, and it never comes back on later turns
            play(LINE[1], 1200)
            expect(arrows() == 0, f'{name}: arrow gone after playing the hinted move')
            # 3. hint, then "Otra línea" (the old bug): the new line starts clean and stays clean
            ask_hint()
            expect(arrows() > 0, f'{name}: hint arrow shown again')
            page.locator('.train button', has_text='Otra línea').first.click(); page.wait_for_timeout(1500)
            expect(arrows() == 0, f'{name}: new line starts without the old arrow')
            for i in range(1, len(LINE), 2):
                play(LINE[i], 900)
                expect(arrows() == 0, f'{name}: no arrow after line move {i // 2 + 1}')
            page.wait_for_timeout(6000)   # bot phase: a couple of bot replies
            expect(arrows() == 0, f'{name}: no arrow during the game against the bot')
            page.screenshot(path=f'/tmp/claude-0/-home-claude/cbe8fd55-5fb6-51a7-a9ce-e5de1aefc5b9/scratchpad/hint-{name}.png')
            if errs: print('page errors', errs[:3]); ok = False
            ctx.close()
        b.close()
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
