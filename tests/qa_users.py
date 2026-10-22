"""Users QA: the master sees who entered which repertoire, blocks one person without changing the key,
and private repertoires stay out of everyone's Biblioteca. Run against the dev server (npm run dev). Exit code 1 on failure."""
import sys
from playwright.sync_api import sync_playwright
from qa_util import BASE, make_world, new_key, new_context, enter_with_key

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
LINE = 'e2e4 c7c5 g1f3 d7d6'
ok = True


def expect(cond, label):
    global ok
    print(('OK   ' if cond else 'FAIL ') + label, flush=True)
    ok &= bool(cond)


def main():
    k_priv, k_pub = new_key('juan'), new_key('club')
    tag = k_priv[-4:].upper()
    PRIV, PUB, JUAN, ANA = f'Najdorf de Juan {tag}', f'Club {tag}', f'Juan {tag}', f'Ana {tag}'
    make_world(PRIV, k_priv, [('Najdorf', 'b', [('n1', LINE)])], hue=0, listed=False)
    make_world(PUB, k_pub, [('Abierta', 'w', [('c1', LINE)])], hue=140, listed=True)

    with sync_playwright() as p:
        b = p.chromium.launch()
        errs = []
        # two students on their phones: Juan (private repertoire + club), Ana (same private key)
        sj = new_context(b, 390, 780).new_page(); sj.on('pageerror', lambda e: errs.append(str(e)))
        enter_with_key(sj, k_pub, name=JUAN)
        sj.locator('.tab', has_text='Biblioteca').click(); sj.wait_for_timeout(800)
        libs = [x.lower() for x in sj.locator('.lib-card .lc-name').all_inner_texts()]
        expect(PRIV.lower() not in libs, 'a private repertoire is not in anyone\'s Biblioteca')
        sj.locator('.topbar .brand').click(); sj.wait_for_timeout(400)
        sj.fill('#key-pass', k_priv); sj.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); sj.wait_for_timeout(1500)
        expect(PRIV.lower() in sj.locator('.world-badge').inner_text().lower(), 'Juan opens his private repertoire with its key')
        sa = new_context(b, 390, 780).new_page(); sa.on('pageerror', lambda e: errs.append(str(e)))
        enter_with_key(sa, k_priv, name=ANA)

        # the master
        m = new_context(b, 1280, 860).new_page(); m.on('pageerror', lambda e: errs.append(str(e)))
        m.goto(BASE); m.wait_for_timeout(700)
        m.locator('.master-star').first.click(); m.fill('#master-pass', 'maestro-dev'); m.get_by_role('button', name='Entrar a la Sala').click(); m.wait_for_timeout(900)
        m.locator('.room-nav button', has_text='Usuarios').click(); m.wait_for_timeout(400)
        m.fill('#user-search', tag); m.wait_for_timeout(300)
        rows = [x.lower() for x in m.locator('.person .pr-name').all_inner_texts()]
        expect(any(JUAN.lower() in r for r in rows) and any(ANA.lower() in r for r in rows), f'Usuarios lists both students {rows}')
        m.screenshot(path=f'{SHOTS}/u01-users.png', full_page=True)
        m.locator('.person').filter(has=m.locator('.pr-name', has_text=JUAN)).click(); m.wait_for_timeout(400)
        names = [x.lower() for x in m.locator('.access .ac-name').all_inner_texts()]
        expect(len(names) == 2 and any(PRIV.lower() in n for n in names), f'Juan\'s profile shows both repertoires {names}')
        m.locator('.access', has_text=PRIV).get_by_role('switch').click(); m.wait_for_timeout(900)
        expect('bloqueado' in m.locator('.access', has_text=PRIV).locator('.ac-state').inner_text().lower(), 'blocked in the profile')
        expect('con acceso' in m.locator('.access', has_text=PUB).locator('.ac-state').inner_text().lower(), 'the other repertoire untouched')
        m.screenshot(path=f'{SHOTS}/u02-profile-blocked.png', full_page=True)

        # Juan is out at his next action; Ana, with the same key, is not
        sj.locator('.tab', has_text='Partidas').click(); sj.wait_for_timeout(1500)
        expect('suspendido' in (sj.locator('.portal .notice').first.inner_text().lower() if sj.locator('.portal .notice').count() else ''), 'Juan is told his access is suspended')
        cards = [x.lower() for x in sj.locator('.wc-name').all_inner_texts()]
        expect(PRIV.lower() not in cards and PUB.lower() in cards, f'the blocked repertoire leaves his cover, the other stays {cards}')
        sj.screenshot(path=f'{SHOTS}/u03-student-blocked.png')
        sj.fill('#key-pass', k_priv); sj.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); sj.wait_for_timeout(800)
        expect('suspendido' in (sj.locator('.key-form .form-error').inner_text().lower() if sj.locator('.key-form .form-error').count() else ''), 'the same key no longer opens it for him')
        sa.locator('.tab', has_text='Partidas').click(); sa.wait_for_timeout(1200)
        expect(PRIV.lower() in sa.locator('.world-badge').inner_text().lower() and sa.locator('.portal').count() == 0, 'Ana keeps playing with the same key')

        # the repertoire's own page: people and access
        m.locator('.access', has_text=PRIV).get_by_role('button', name='Partidas').count()
        m.locator('.room-top .btn', has_text='Todos los usuarios').click(); m.wait_for_timeout(300)
        m.locator('.room-nav button', has_text='Repertorios').click(); m.wait_for_timeout(300)
        m.locator('.aw-main', has_text=PRIV).click(); m.wait_for_timeout(900)
        rows = m.locator('.students tbody tr')
        expect(rows.count() == 2, 'the repertoire lists its two people')
        expect(m.locator('.students tr.blocked', has_text=JUAN).count() == 1, 'Juan shown as blocked there too')
        expect(m.locator('.panel', has_text='Personas').locator('.help', has_text='otro nombre').count() == 1, 'hint: a blocked guest could come back with another name')
        m.screenshot(path=f'{SHOTS}/u04-world-people.png', full_page=True)
        # restore from the repertoire page
        m.locator('.students tr', has_text=JUAN).get_by_role('switch').click(); m.wait_for_timeout(900)
        sj.fill('#key-pass', k_priv); sj.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click(); sj.wait_for_timeout(1500)
        expect(PRIV.lower() in sj.locator('.world-badge').inner_text().lower(), 'restored: Juan is back in with the same key')
        if errs: print('page errors', errs[:3]); expect(False, 'no page errors')
        b.close()
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
