"""Order QA: training the lines at random or one after another, chosen from the gear or the Biblioteca.
Checks the sequence, skipping, reloading, lines out of training, «Volver a la primera», the lap and the layout.
Run against the dev server (npm run dev). Exit code 1 on failure."""
import sys
from playwright.sync_api import sync_playwright
from qa_util import make_world, new_key, new_context, enter_with_key, begin, BASE

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
LINE = "() => window.__traynskoLine ? window.__traynskoLine() : null"
ok = True

UNO = [('o1', 'e2e4 e7e5 g1f3 b8c6'), ('o2', 'e2e4 c7c5 g1f3 d7d6'), ('o3', 'd2d4 d7d5 c2c4 e7e6')]
DOS = [('o4', 'c2c4 e7e5 b1c3 g8f6'), ('o5', 'g1f3 d7d5 g2g3 c7c6')]
UCI = dict(UNO + DOS)


def expect(cond, label):
    global ok
    print(('OK   ' if cond else 'FAIL ') + label, flush=True)
    ok &= bool(cond)


def cur(page):
    """Which line (o1…o5) is on the board."""
    u = page.evaluate(LINE)
    return next((k for k, v in UCI.items() if v == u), u)


def tab(page, name):
    page.locator('.tabs .tab', has_text=name).first.click(); page.wait_for_timeout(500)


def other_line(page, wait=1400):
    page.locator('.train .actions button', has_text='Otra línea').click(); page.wait_for_timeout(wait)


def ready_pick(page):
    return page.locator('.train .ready-pick').inner_text().strip() if page.locator('.train .ready-pick').count() else ''


def order_text(page):
    return page.locator('.lm-order-text').inner_text().replace('\n', ' ')


def main():
    key = new_key('orden')
    tag = key[-4:].upper()
    make_world(f'Orden {tag}', key, [('Uno', 'w', UNO), ('Dos', 'w', DOS)], hue=50)

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = new_context(b, 390, 760)
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        enter_with_key(page, key, name='Orden')

        # ---------- default: at random, as before ----------
        expect(page.locator('.train .ready-pick').count() == 0, 'at random with every line in play: no counter on the board')
        tab(page, 'Biblioteca')
        seg = page.locator('#lm-order button[aria-checked="true"]')
        expect(seg.inner_text().strip() == 'Al azar', 'Biblioteca: «Al azar» selected by default')
        expect('al azar' in order_text(page).lower(), 'Biblioteca explains the random mode')
        expect(page.locator('.lm-line.is-next').count() == 0, 'at random: no line marked as next')
        page.screenshot(path=f'{SHOTS}/o01-library-random.png')

        # ---------- gear: «En orden» ----------
        tab(page, 'Entrenar')
        page.locator('.train .gear-btn').click(); page.wait_for_timeout(300)
        expect(page.locator('#go-order button').count() == 2, 'gear: the two ways to choose lines')
        expect(page.locator('#go-order button[aria-checked="true"]').inner_text().strip() == 'Al azar', 'gear: «Al azar» selected')
        page.screenshot(path=f'{SHOTS}/o02-gear.png')
        page.locator('#go-order button', has_text='En orden').click(); page.wait_for_timeout(500)
        expect(page.locator('#go-order button[aria-checked="true"]').inner_text().strip() == 'En orden', 'gear: «En orden» selected')
        page.locator('.game-opts .icon-btn[aria-label="Cerrar"]').click(); page.wait_for_timeout(400)
        expect(cur(page) == 'o1', f'in order: the first line waits on the board ({cur(page)})')
        expect('línea 1 de 5' in ready_pick(page), f'the board says where the order stands ({ready_pick(page)})')
        page.screenshot(path=f'{SHOTS}/o03-ready-ordered.png')

        # ---------- skipping before starting, and reloading ----------
        other_line(page)
        expect(cur(page) == 'o2' and page.locator('.train .ready-layer').count() == 1, f'«Otra línea» before starting: the second one waits ({cur(page)})')
        expect('línea 2 de 5' in ready_pick(page), f'counter follows ({ready_pick(page)})')
        page.reload(); page.wait_for_selector('.train cg-board'); page.wait_for_timeout(1500)
        expect(cur(page) == 'o2', f'reloading keeps the line that was waiting ({cur(page)})')
        begin(page)
        expect(page.locator('.train .ready-layer').count() == 0, 'the line starts')
        other_line(page)
        expect(cur(page) == 'o3' and page.locator('.train .ready-layer').count() == 0, f'«Otra línea» during a line: the next one starts at once ({cur(page)})')

        # ---------- Biblioteca: same setting, the next line marked ----------
        tab(page, 'Biblioteca')
        page.locator('.rep-open', has_text='Dos').click(); page.wait_for_timeout(300)
        expect(page.locator('#lm-order button[aria-checked="true"]').inner_text().strip() == 'En orden', 'Biblioteca shows the choice made in the gear')
        expect('4 de 5' in order_text(page), f'Biblioteca: next is the 4th of 5 ({order_text(page)})')
        nxt = page.locator('.lm-line.is-next')
        expect(nxt.count() == 1 and 'o4' in nxt.inner_text(), 'the next line is marked in the list')
        page.screenshot(path=f'{SHOTS}/o04-library-ordered.png', full_page=True)

        # a line out of training is skipped
        page.locator('.lm-line', has_text='o4').locator('.check').click(); page.wait_for_timeout(400)
        expect('4 de 4' in order_text(page) and 'o5' in page.locator('.lm-line.is-next').inner_text(), f'o4 out of training: o5 is next ({order_text(page)})')

        # back to the first line, even with a game running
        expect('«Dos»' in order_text(page), f'the text names the chapter of the next line ({order_text(page)})')
        page.get_by_role('button', name='Volver a la primera').click(); page.wait_for_timeout(400)
        page.locator('.rep-open', has_text='Uno').click(); page.wait_for_timeout(300)
        expect('1 de 4' in order_text(page) and 'o1' in page.locator('.lm-line.is-next').inner_text(), f'«Volver a la primera» ({order_text(page)})')
        expect(page.get_by_role('button', name='Volver a la primera').count() == 0, 'no restart button when already at the first line')
        tab(page, 'Entrenar')
        expect(cur(page) == 'o3', 'the game in progress is left alone')
        seen = []
        for _ in range(4):
            other_line(page)
            seen.append(cur(page))
        expect(seen == ['o1', 'o2', 'o3', 'o5'], f'then one after another, skipping o4: {seen}')
        other_line(page, wait=300)
        banner = page.locator('.train .banner').inner_text() if page.locator('.train .banner').count() else ''
        expect(cur(page) == 'o1' and 'vuelta completa' in banner.lower(), f'after the last line, a new lap from the first ({cur(page)}, «{banner}»)')
        page.wait_for_timeout(1200)
        page.screenshot(path=f'{SHOTS}/o05-lap.png')

        # ---------- Biblioteca: back to random ----------
        tab(page, 'Biblioteca')
        page.locator('#lm-order button', has_text='Al azar').click(); page.wait_for_timeout(400)
        expect('al azar' in order_text(page).lower() and page.locator('.lm-line.is-next').count() == 0, 'Biblioteca: back to random')
        tab(page, 'Entrenar')
        picks = set()
        for _ in range(8):
            other_line(page, wait=900)
            picks.add(cur(page))
        expect(len(picks) >= 3 and 'o4' not in picks, f'random again, among the lines in play: {sorted(picks)}')

        # ---------- the order resumes where it was ----------
        tab(page, 'Biblioteca')
        page.locator('#lm-order button', has_text='En orden').click(); page.wait_for_timeout(400)
        expect('2 de 4' in order_text(page), f'back in order: it goes on after the last line played in order ({order_text(page)})')

        # ---------- layout: gear and Biblioteca from phone to desktop ----------
        for (w, h) in [(320, 568), (360, 640), (375, 553), (390, 844), (768, 1024), (1024, 700), (1440, 900), (844, 390)]:
            c2 = new_context(b, w, h)
            pg = c2.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            enter_with_key(pg, key, name='Orden')
            pg.locator('.train .gear-btn').click(); pg.wait_for_timeout(350)
            fits = pg.evaluate("""() => {
                const s = document.querySelector('.game-opts'); const r = s.getBoundingClientRect();
                const bs = [...s.querySelectorAll('#go-order button')].map((x) => x.getBoundingClientRect());
                const over = [...s.querySelectorAll('#go-order button, .go-start, .go-more')].some((x) => x.scrollWidth > x.clientWidth + 1);
                const fitsH = innerHeight <= 500 || s.scrollHeight <= s.clientHeight + 1;
                return r.left >= -1 && r.right <= innerWidth + 1 && bs.length === 2 && bs.every((x) => x.right <= r.right + 1 && x.width > 60) && !over && fitsH && document.documentElement.scrollWidth <= innerWidth;
            }""")
            expect(fits, f'{w}x{h}: gear fits (no scrolling on phones taller than 500px), both options readable')
            pg.screenshot(path=f'{SHOTS}/o06-gear-{w}x{h}.png')
            pg.locator('.game-opts .icon-btn[aria-label="Cerrar"]').click(); pg.wait_for_timeout(250)
            tab(pg, 'Biblioteca')
            pg.locator('#lm-order button', has_text='En orden').click(); pg.wait_for_timeout(350)
            row = pg.evaluate("""() => {
                const o = document.querySelector('.lm-order'); const r = o.getBoundingClientRect();
                const kids = [...o.children].map((x) => x.getBoundingClientRect());
                return kids.every((k) => k.left >= r.left - 1 && k.right <= r.right + 1) && document.documentElement.scrollWidth <= innerWidth;
            }""")
            expect(row, f'{w}x{h}: Biblioteca order row fits')
            pg.locator('.lm-order').scroll_into_view_if_needed()
            pg.screenshot(path=f'{SHOTS}/o07-library-{w}x{h}.png')
            c2.close()

        expect(not errs, f'no page errors {errs[:3]}')
        b.close()
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
