"""Shared helpers for the browser checks (run against `npm run dev`)."""
import json, random, string, urllib.request

BASE = 'http://localhost:8790'


def rand_ip():
    return f'10.{random.randint(1, 250)}.{random.randint(0, 255)}.{random.randint(1, 254)}'


def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + '/api/' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'x-test-ip': rand_ip(), **({'Authorization': 'Bearer ' + token} if token else {})})
    return json.loads(urllib.request.urlopen(req).read())


def new_key(prefix='qa'):
    """A key no other repertoire on the dev server uses (the key alone picks the repertoire)."""
    return prefix + '-' + ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))


def make_world(name, key, chapters, hue=210, emblem='pawn', subtitle='', listed=True, account_only=False):
    """chapters: [(chapter name, 'w'|'b', [(line id, uci string), ...]), ...]"""
    t = api('POST', 'admin/login', {'password': 'maestro-dev'})['token']
    w = api('POST', 'admin/worlds', {'name': name, 'subtitle': subtitle, 'password': key, 'emblem': emblem, 'hue': hue, 'listed': listed, 'accountOnly': account_only}, t)['world']
    for cname, color, lines in chapters:
        api('POST', f"admin/worlds/{w['id']}/reps", {'name': cname, 'color': color, 'lines': [
            {'id': lid, 'event': cname, 'white': 'QA', 'black': lid, 'uci': uci} for lid, uci in lines]}, t)
    return w


def new_context(browser, width, height, touch=None, **kw):
    touch = (width < 1000) if touch is None else touch
    ctx = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=2 if touch else 1,
                              is_mobile=touch and width < 1000, has_touch=touch, **kw)
    ctx.set_extra_http_headers({'x-test-ip': rand_ip()})   # the dev server rate-limits per IP
    return ctx


def enter_with_key(page, key, name='QA', goto=True):
    """From the cover: name (if asked) + key -> the repertoire opens on its board, waiting to start."""
    if goto:
        page.goto(BASE); page.wait_for_timeout(700)
    if page.locator('#key-name').count():
        page.fill('#key-name', name)
    page.fill('#key-pass', key)
    page.locator('.key-form').get_by_role('button', name='Entrar', exact=True).click()
    page.wait_for_selector('.train cg-board', timeout=15000)
    page.wait_for_timeout(1200)


def begin(page):
    """«Comenzar partida»."""
    page.locator('.train .start-btn').click()
    page.wait_for_timeout(700)


def square_xy(page, s):
    """Centre of square s on the training board, whichever way it is oriented."""
    box = page.locator('.train cg-board').bounding_box(); u = box['width'] / 8
    white = page.evaluate("() => document.querySelector('.train .cg-wrap').classList.contains('orientation-white')")
    f, r = ord(s[0]) - 97, int(s[1]) - 1
    col, row = (f, 7 - r) if white else (7 - f, r)
    return box['x'] + (col + .5) * u, box['y'] + (row + .5) * u


def play(page, uci, wait=700, touch=False):
    a, b = square_xy(page, uci[:2]), square_xy(page, uci[2:4])
    if touch:
        page.touchscreen.tap(*a); page.wait_for_timeout(60); page.touchscreen.tap(*b)
    else:
        page.mouse.click(*a); page.wait_for_timeout(60); page.mouse.click(*b)
    page.wait_for_timeout(wait)
