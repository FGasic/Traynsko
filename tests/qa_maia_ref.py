"""Maia in the browser (worker + ONNX Runtime Web + this app's encoding) against the Python reference
(tests/fixtures/maia_ref.json, made with the reference tokenization on the original float32 model).
Run against the dev server (npm run dev) after `npx esbuild tests/harness/maia-probe.ts --bundle --format=iife --outfile=.dev/maia-probe.js`."""
import json, os, re, sys
from playwright.sync_api import sync_playwright
from qa_util import BASE

HERE = os.path.dirname(os.path.abspath(__file__))
cases = json.load(open(os.path.join(HERE, 'fixtures', 'maia_ref.json')))
probe = open(os.path.join(HERE, '..', '.dev', 'maia-probe.js')).read()
html = open(os.path.join(HERE, '..', 'dist', 'index.html')).read()
worker = '/' + re.search(r'maia-worker\.[a-z0-9]+\.js', ' '.join(os.listdir(os.path.join(HERE, '..', 'dist')))).group(0)
model = '/maia/' + os.listdir(os.path.join(HERE, '..', 'dist', 'maia'))[0]
ok = True
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + '/__blank'); page.wait_for_timeout(300)
    page.add_script_tag(content=probe)
    res = page.evaluate("""async ([cases, worker, model]) => {
      const P = window.__maiaProbe;
      const m = new P.Maia(worker, model);
      const t0 = performance.now();
      await m.load();
      const load = performance.now() - t0;
      const out = []; const times = [];
      for (const c of cases) {
        const t = performance.now();
        const pol = await m.policy(c.fens, c.elo, c.elo, 0);
        times.push(performance.now() - t);
        out.push({ top: pol.moves.slice(0, 5).map((x) => [x.uci, x.p]), wdl: pol.wdl });
      }
      return { load, times, out, state: m.state };
    }""", [cases, worker, model])
    print(f"load {res['load']:.0f} ms, state {res['state']}, inference median {sorted(res['times'])[len(res['times'])//2]:.0f} ms, max {max(res['times']):.0f} ms")
    worst = 0; top1 = 0
    for c, o in zip(cases, res['out']):
        ref = dict(c['top']); got = dict(o['top'])
        diff = max(abs(ref[u] - got.get(u, 0)) for u in ref)
        worst = max(worst, diff); top1 += c['top'][0][0] == o['top'][0][0]
    print(f'{len(cases)} positions: same top move {top1}/{len(cases)}, largest probability difference {worst:.4f}')
    ok = top1 >= len(cases) - 1 and worst < 0.01 and not errs
    print('errors', errs[:3])
    b.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
