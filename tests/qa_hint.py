"""Hint arrow QA: the green arrow must disappear as soon as the position changes, a new line starts or the game moves on.
Run against the dev server (npm run dev). Exit code 1 on failure."""
import sys
from playwright.sync_api import sync_playwright
from qa_util import make_world, new_key, new_context, enter_with_key, begin, play

LINE = "d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6".split()   # user = black, short line so the bot phase starts quickly
ARROWS = "() => document.querySelectorAll('.train cg-container svg.cg-shapes line').length"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'


def main():
    key = new_key('pista')
    make_world('Pistas QA', key, [('Benko corto', 'b', [('h1', ' '.join(LINE))])], hue=200)
    ok = True

    def expect(cond, label):
        nonlocal ok
        print(('OK   ' if cond else 'FAIL ') + label, flush=True)
        ok &= bool(cond)

    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, w, h in [('desktop', 1366, 800), ('phone', 360, 640)]:
            ctx = new_context(b, w, h)
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            enter_with_key(page, key)
            begin(page)
            arrows = lambda: page.evaluate(ARROWS)

            def ask_hint():
                for _ in range(3): play(page, 'e7e6', 450)          # legal but wrong
                page.locator('.train .status-card button', has_text='Ver').first.click(); page.wait_for_timeout(300)

            # 1. hint, then a wrong move: the arrow stays (the help is still valid)
            ask_hint()
            expect(arrows() > 0, f'{name}: hint arrow shown')
            play(page, 'e7e6', 600)
            expect(arrows() > 0, f'{name}: hint arrow still shown after another wrong try')
            # 2. playing the move removes it, and it never comes back on later turns
            play(page, LINE[1], 1200)
            expect(arrows() == 0, f'{name}: arrow gone after playing the hinted move')
            # 3. hint, then "Otra línea": the new line starts clean and stays clean
            ask_hint()
            expect(arrows() > 0, f'{name}: hint arrow shown again')
            page.locator('.train .actions button', has_text='Otra línea').first.click(); page.wait_for_timeout(1500)
            expect(arrows() == 0, f'{name}: new line starts without the old arrow')
            for i in range(1, len(LINE), 2):
                play(page, LINE[i], 900)
                expect(arrows() == 0, f'{name}: no arrow after line move {i // 2 + 1}')
            page.wait_for_timeout(6000)   # bot phase: a couple of bot replies
            expect(arrows() == 0, f'{name}: no arrow during the game against the bot')
            page.screenshot(path=f'{SHOTS}/hint-{name}.png')
            if errs: print('page errors', errs[:3]); ok = False
            ctx.close()
        b.close()
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
