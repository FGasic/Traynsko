"""Biblioteca QA: the player's own sets of lines, dragging (mouse and finger), search by move or name,
"train only these", folding, the selection reaching the training, and the same selection on another device.
Run against the dev server (npm run dev). Exit code 1 on failure."""
import json, os, sys
from playwright.sync_api import sync_playwright
from qa_util import api, new_key, new_context, enter_with_key, BASE

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
ok = True
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')


def expect(cond, label):
    global ok
    print(('OK   ' if cond else 'FAIL ') + label, flush=True)
    ok &= bool(cond)


def summary(page):
    return page.locator('.lm-top .summary').inner_text()


def set_box(page, name):
    return page.locator('.lm-set', has=page.locator('.lm-set-name', has_text=name)).first


def set_count(page, name):
    return int(set_box(page, name).locator('.lm-count').first.inner_text().split('/')[-1])


class Finger:
    """Drag with the mouse or with a finger (touch events through the DevTools protocol, as a phone sends them)."""
    def __init__(self, page, cdp=None):
        self.page, self.cdp = page, cdp

    def _send(self, kind, x=0, y=0):
        if self.cdp:
            t = {'down': 'touchStart', 'move': 'touchMove', 'up': 'touchEnd'}[kind]
            self.cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [] if kind == 'up' else [{'x': x, 'y': y}]})
        elif kind == 'down':
            self.page.mouse.move(x, y); self.page.mouse.down()
        elif kind == 'move':
            self.page.mouse.move(x, y)
        else:
            self.page.mouse.up()

    def glide(self, x0, y0, x1, y1, steps=8):
        for i in range(1, steps + 1):
            self._send('move', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); self.page.wait_for_timeout(16)
        return x1, y1

    def drag(self, row, target_fn, hold_top=None):
        """The handle of `row` onto the target; with `hold_top`, first held near the top edge so the page scrolls."""
        page = self.page
        g = row.locator('.lm-grip').bounding_box()
        x, y = g['x'] + g['width'] / 2, g['y'] + g['height'] / 2
        self._send('down', x, y); page.wait_for_timeout(50)
        if hold_top is not None:
            x, y = self.glide(x, y, x, hold_top)
            page.wait_for_timeout(1600)                       # the page scrolls up while the pointer waits there
            x, y = self.glide(x, y, x, page.viewport_size['height'] / 2, 4)
            page.wait_for_timeout(150)
        t = target_fn().bounding_box()
        x, y = self.glide(x, y, t['x'] + 60, t['y'] + 18)
        page.wait_for_timeout(120)
        self._send('up'); page.wait_for_timeout(350)


def no_overflow(page):
    return page.evaluate("() => { const p = document.querySelector('.screen.page'); return document.documentElement.scrollWidth <= innerWidth && (!p || p.scrollWidth <= p.clientWidth + 1); }")


def main():
    # 58 Sicilian lines (the base lines of siciliana-negras.pgn, each with a few branches) and the 3 Benko lines
    big = json.load(open(os.path.join(FIX, 'siciliana-grande.json')))
    benko = json.load(open(os.path.join(FIX, 'benko-negras.json')))
    alapin = [l for l in big if l['uci'].startswith('e2e4 c7c5 c2c3')]
    moscow = [l for l in big if l['white'].startswith('Moscú')]
    total = len(big) + len(benko)
    key = new_key('lib')
    tag = key[-4:].upper()
    t = api('POST', 'admin/login', {'password': 'maestro-dev'})['token']
    w = api('POST', 'admin/worlds', {'name': f'Siciliana {tag}', 'subtitle': 'Negras', 'password': key, 'emblem': 'knight', 'hue': 215}, t)['world']
    api('POST', f"admin/worlds/{w['id']}/reps", {'name': 'Siciliana con negras', 'color': 'b', 'lines': big}, t)
    api('POST', f"admin/worlds/{w['id']}/reps", {'name': 'Benko', 'color': 'b', 'lines': benko}, t)

    with sync_playwright() as p:
        b = p.chromium.launch()
        # ================= desktop, mouse =================
        ctx = new_context(b, 1280, 900)
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        enter_with_key(page, key, name='Marta')
        expect(page.locator('.ready-pick').count() == 0, 'every line in play: no line count on the board')
        page.locator('.tab', has_text='Biblioteca').click(); page.wait_for_timeout(600)
        expect(page.locator('.lib-current .rep').count() == 2, 'both chapters listed')
        expect(f'{total} de {total}' in summary(page).replace('\n', ' '), f'summary: all in play ({summary(page)})')
        page.locator('.rep-open').first.click(); page.wait_for_timeout(300)
        expect(page.locator('.lm-line').count() == len(big), f'chapter open: {len(big)} lines')

        # a new empty set
        page.get_by_role('button', name='Nuevo conjunto').click()
        page.get_by_label('Nombre del conjunto').fill('Alapin'); page.get_by_role('button', name='Crear', exact=True).click(); page.wait_for_timeout(300)
        expect(set_box(page, 'Alapin').count() == 1 and set_box(page, 'Alapin').locator('.lm-empty').count() == 1, 'empty set created, with a hint')

        # search by move, group the results into the set
        page.fill('#lm-query', '2.c3'); page.wait_for_timeout(300)
        expect(page.locator('.lm-line').count() == len(alapin), f'2.c3 finds the {len(alapin)} Alapin lines')
        expect(page.locator('.lm-line mark').first.inner_text() == 'c3', 'the move is highlighted')
        page.get_by_role('button', name='Agrupar…').click(); page.wait_for_timeout(200)
        page.locator('.lm-target', has_text='Alapin').click(); page.wait_for_timeout(300)
        page.fill('#lm-query', ''); page.wait_for_timeout(300)
        expect(set_count(page, 'Alapin') == len(alapin), f'Alapin set holds {len(alapin)} lines')
        expect(page.locator('.lm-loose-head', has_text='Sin conjunto').count() == 1, '«Sin conjunto» shows once there are sets')

        # a set from a line's menu, then a mouse drag into it
        first_moscow = page.locator('.lm-line', has=page.locator('.lm-name', has_text='Moscú')).first
        first_moscow.locator('.lm-more').click(); page.wait_for_timeout(200)
        page.get_by_label('Nombre del nuevo conjunto').fill('Moscú'); page.locator('.lm-sheet').get_by_role('button', name='Crear', exact=True).click(); page.wait_for_timeout(400)
        expect(set_count(page, 'Moscú') == 1, 'set created from a line menu, with that line')
        loose_moscow = page.locator('.lm-set.loose .lm-line', has=page.locator('.lm-name', has_text='Moscú')).first
        loose_moscow.scroll_into_view_if_needed()
        top = page.evaluate("() => document.querySelector('.screen.page').getBoundingClientRect().top")
        Finger(page).drag(loose_moscow, lambda: set_box(page, 'Moscú').locator('.lm-set-head'), hold_top=top + 16)
        expect(set_count(page, 'Moscú') == 2, 'mouse drag: line dropped into «Moscú»')
        page.screenshot(path=f'{SHOTS}/l01-sets-desktop.png')

        # fold, take a set out of training
        set_box(page, 'Alapin').locator('.lm-set-title').click(); page.wait_for_timeout(200)
        expect(set_box(page, 'Alapin').locator('.lm-line').count() == 0 and set_count(page, 'Alapin') == len(alapin), 'folded: only the title (and its count)')
        set_box(page, 'Alapin').locator('.lm-set-head .check').click(); page.wait_for_timeout(200)
        expect(f'{total - len(alapin)} de {total}' in summary(page), f'Alapin out of training ({summary(page)})')
        expect(page.locator('.lib-current .rep .rep-main .check').first.get_attribute('aria-checked') == 'mixed', 'chapter shows partly selected')

        # train only the lines with one move
        page.fill('#lm-query', '12.Ae3'); page.wait_for_timeout(300)
        hits = page.locator('.lm-line').count()
        expect(hits >= 1, f'12.Ae3 finds {hits} line(s)')
        page.locator('.lm-results .btn.primary').click(); page.wait_for_timeout(300)
        expect(f'{hits} de {total}' in summary(page), f'only those in play ({summary(page)})')
        page.fill('#lm-query', ''); page.wait_for_timeout(1500)   # let the change reach the server
        page.screenshot(path=f'{SHOTS}/l02-only-desktop.png')

        # the training uses them
        page.locator('.tab', has_text='Entrenar').click(); page.wait_for_timeout(700)
        rp = page.locator('.ready-pick')
        expect(rp.count() == 1 and (f'{hits} de {total}' in rp.inner_text() or '1 línea elegida' in rp.inner_text()), f'the board says how many lines are chosen: {rp.inner_text() if rp.count() else None}')
        seen = set()
        for _ in range(6):
            seen.add(page.evaluate('() => window.__traynskoLine()'))
            page.get_by_role('button', name='Otra línea').click(); page.wait_for_timeout(250)
        ok_lines = all(u and u.split()[22:23] == ['c1e3'] for u in seen)
        expect(ok_lines and len(seen) <= hits, f'every line offered plays 12.Be3 ({len(seen)} distinct)')
        page.screenshot(path=f'{SHOTS}/l03-board-desktop.png')

        # another device, same person: same sets and selection
        ctx2 = new_context(b, 1280, 900)
        p2 = ctx2.new_page()
        enter_with_key(p2, key, name='Marta')
        p2.locator('.tab', has_text='Biblioteca').click(); p2.wait_for_timeout(900)
        expect(f'{hits} de {total}' in summary(p2), f'other device: same selection ({summary(p2)})')
        p2.locator('.rep-open').first.click(); p2.wait_for_timeout(300)
        expect(set_box(p2, 'Alapin').count() == 1 and set_box(p2, 'Moscú').count() == 1, 'other device: same sets')
        ctx2.close()

        # another person: untouched
        ctx3 = new_context(b, 1280, 900)
        p3 = ctx3.new_page()
        enter_with_key(p3, key, name='Luis')
        p3.locator('.tab', has_text='Biblioteca').click(); p3.wait_for_timeout(900)
        expect(f'{total} de {total}' in summary(p3), 'another person keeps everything in play')
        ctx3.close()

        # set menu: rename, move, delete; everything back in
        page.locator('.tab', has_text='Biblioteca').click(); page.wait_for_timeout(500)
        set_box(page, 'Moscú').locator('.lm-set-head .lm-more').click(); page.wait_for_timeout(200)
        page.get_by_label('Nuevo nombre del conjunto').fill('Moscú 3.Ab5+'); page.locator('.lm-sheet').get_by_role('button', name='Guardar').click(); page.wait_for_timeout(300)
        expect(set_box(page, 'Moscú 3.Ab5+').count() == 1, 'renamed')
        names = page.locator('.lm-set-name').all_inner_texts()
        set_box(page, 'Moscú 3.Ab5+').locator('.lm-set-head .lm-more').click(); page.wait_for_timeout(200)
        page.locator('.lm-sheet').get_by_role('button', name='Subir').click(); page.wait_for_timeout(300)
        names2 = page.locator('.lm-set-name').all_inner_texts()
        expect([n.lower() for n in names2[:2]] == [names[1].lower(), names[0].lower()], f'moved up: {names2[:2]}')
        set_box(page, 'Moscú 3.Ab5+').locator('.lm-set-head .lm-more').click(); page.wait_for_timeout(200)
        page.locator('.lm-sheet').get_by_role('button', name='Eliminar conjunto').click()
        page.locator('.lm-sheet').get_by_role('button', name='Eliminar', exact=True).click(); page.wait_for_timeout(300)
        expect(set_box(page, 'Moscú 3.Ab5+').count() == 0 and page.locator('.lm-line').count() == len(big) - len(alapin), 'set deleted, its lines stay (Alapin folded)')
        page.get_by_role('button', name='Activar todas').click(); page.wait_for_timeout(300)
        expect(f'{total} de {total}' in summary(page), 'Activar todas')
        expect(no_overflow(page), 'desktop: no sideways scroll')
        expect(not errs, f'desktop: no errors {errs}')
        ctx.close()

        # ================= phone, finger =================
        for W, H in [(390, 844), (320, 640)]:
            ctx = new_context(b, W, H)
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            cdp = ctx.new_cdp_session(page)
            enter_with_key(page, key, name=f'Pedro{W}')
            page.locator('.tab', has_text='Biblioteca').click(); page.wait_for_timeout(600)
            page.locator('.rep-open').first.click(); page.wait_for_timeout(300)
            page.get_by_role('button', name='Nuevo conjunto').scroll_into_view_if_needed()
            page.get_by_role('button', name='Nuevo conjunto').click()
            page.get_by_label('Nombre del conjunto').fill('Najdorf'); page.get_by_role('button', name='Crear', exact=True).click(); page.wait_for_timeout(300)
            # the new set sits at the top of the chapter; drag the first line into it
            first = page.locator('.lm-set.loose .lm-line').first
            first.scroll_into_view_if_needed()
            Finger(page, cdp).drag(first, lambda: set_box(page, 'Najdorf').locator('.lm-set-head'))
            expect(set_count(page, 'Najdorf') == 1, f'{W}px finger drag: line dropped into the set')
            # a line far down the list: hold near the top so the page scrolls, then drop
            far = page.locator('.lm-set.loose .lm-line').nth(12)
            far.scroll_into_view_if_needed(); page.wait_for_timeout(200)
            scroller_top = page.evaluate("() => document.querySelector('.screen.page').getBoundingClientRect().top")
            before = page.evaluate("() => document.querySelector('.screen.page').scrollTop")
            Finger(page, cdp).drag(far, lambda: set_box(page, 'Najdorf').locator('.lm-set-head'), hold_top=scroller_top + 20)
            after = page.evaluate("() => document.querySelector('.screen.page').scrollTop")
            expect(after < before, f'{W}px: the page scrolls while dragging near the edge ({before} -> {after})')
            expect(set_count(page, 'Najdorf') == 2, f'{W}px: dropped after scrolling')
            expect(page.locator('.lm-ghost').count() == 0, f'{W}px: nothing left floating')
            # a plain swipe on a line still scrolls the page (only the handle drags)
            page.fill('#lm-query', 'Cf6'); page.wait_for_timeout(300)
            expect(page.locator('.lm-line').count() > 0, f'{W}px: search works')
            page.screenshot(path=f'{SHOTS}/l04-search-{W}.png')
            page.fill('#lm-query', ''); page.wait_for_timeout(200)
            expect(no_overflow(page), f'{W}px: no sideways scroll')
            page.locator('.lm-set.loose .lm-line .lm-more').first.click(); page.wait_for_timeout(250)
            sheet = page.locator('.lm-sheet').bounding_box()
            expect(sheet and sheet['x'] >= 0 and sheet['x'] + sheet['width'] <= W + 1, f'{W}px: move sheet fits')
            page.screenshot(path=f'{SHOTS}/l05-move-sheet-{W}.png')
            page.locator('.lm-sheet').get_by_role('button', name='Cerrar').click(); page.wait_for_timeout(200)
            page.evaluate("() => document.querySelector('.screen.page').scrollTo(0, 0)"); page.wait_for_timeout(100)
            page.screenshot(path=f'{SHOTS}/l06-top-{W}.png')
            expect(not errs, f'{W}px: no errors {errs}')
            ctx.close()
        b.close()
    print('ALL OK' if ok else 'SOME CHECKS FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
