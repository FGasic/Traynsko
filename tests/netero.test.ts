// Modo Netero: scoring, streak and records (shared), the session engine, and the server's endpoints.
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import {
  NETERO, applyRecord, bumpStreak, cleanSummary, liveStreak, neteroScore, nextBest, nextQueue, recordFor, scopeFingerprint,
  type NeteroRecord, type NeteroSummary,
} from '../shared/netero';
import { lineKey } from '../shared/picks';
import { ANIM_MS, WRONG_MS, NeteroRun, planDaily, planErrors, planFull, userPlies, type Plan } from '../src/lib/netero';
import type { Line, Repertoire } from '../shared/types';
import { createApp } from '../server/core';
import { memoryKV } from '../server/kv';
import { hashSecret } from '../server/crypto';

let ok = 0, bad = 0;
const check = (cond: boolean, msg: string) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const benko: Line[] = JSON.parse(readFileSync('tests/fixtures/benko-negras.json', 'utf8'));
const rep = (id: string, name: string, color: 'w' | 'b', lines: Line[]): Repertoire => ({ id, name, color, lineCount: lines.length, lines });
const reps = [rep('benko1', 'Benko Principal', 'b', benko)];
const WORLD = { kind: 'world' as const, id: 'w1', name: 'Benko' };

/** A seeded generator, so orders are repeatable. */
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/** Plays a session to the end with a fake clock. `think(i)` is the player's time on their i-th move (ms);
 *  `fail(i)` says whether they first play a wrong move there (and how long they took before it). */
function play(run: NeteroRun, clock: { t: number }, think: (i: number) => number, fail: (i: number, pass: number) => number | null = () => null) {
  let i = 0;
  run.begin();
  for (let guard = 0; guard < 5000 && run.status !== 'done'; guard++) {
    if (run.status === 'between') { clock.t += 900; run.next(); continue; }
    if (run.autoDue) { clock.t += 250; run.autoMove(); continue; }
    if (run.userTurn) {
      const exp = run.expected!;
      const before = fail(i, run.pass);
      if (before !== null) {
        clock.t += ANIM_MS + before;
        const wrong = new Chess(run.chess.fen()).moves({ verbose: true }).find((m) => m.from + m.to !== exp)!;
        const r = run.userMove(wrong.from + wrong.to + (wrong.promotion ?? ''));
        check(r.kind === 'wrong', 'a wrong move is reported');
        clock.t += WRONG_MS;
        if (run.userTurn) { clock.t += think(i); run.userMove(exp); }
      } else {
        clock.t += ANIM_MS + think(i);
        run.userMove(exp);
      }
      i++;
      continue;
    }
    break;
  }
}

(async () => {
  /* ---------- scoring ---------- */
  let s = neteroScore(12, 11, 12 * 2500);
  check(near(s.precision, 11 / 12) && near(s.ritmo, 0.8) && Math.round(s.nota) === 73, 'spec example: 12 nodes, 11 right, 2.5 s → 73');
  s = neteroScore(10, 10, 10 * 1500);
  check(s.ritmo === 1 && s.nota === 100, 'faster than t100 scores 100');
  check(neteroScore(0, 0, 0).nota === 0, 'no nodes, no score');
  check(NETERO.t100Ms === 2000 && NETERO.dailyDefault === 5, 'parameters as specified');

  /* ---------- streak ---------- */
  let st = bumpStreak(null, '2026-11-20');
  check(st.counted && st.streak.cur === 1 && st.streak.best === 1, 'first daily starts the streak');
  st = bumpStreak(st.streak, '2026-11-20');
  check(!st.counted && st.streak.cur === 1, 'a second daily the same day is practice');
  st = bumpStreak(st.streak, '2026-11-21');
  check(st.counted && st.streak.cur === 2 && st.streak.best === 2, 'next day adds one');
  st = bumpStreak(st.streak, '2026-11-24');
  check(st.counted && st.streak.cur === 1 && st.streak.best === 2, 'a missed day restarts it (best kept)');
  check(liveStreak(st.streak, '2026-11-25').cur === 1 && !liveStreak(st.streak, '2026-11-25').doneToday, 'streak alive the day after');
  check(liveStreak(st.streak, '2026-11-26').cur === 0, 'streak broken after a whole day without daily');
  check(liveStreak(st.streak, '2026-11-24').doneToday, 'done today');
  check(bumpStreak({ cur: 3, best: 3, last: '2026-12-31' }, '2027-01-01').streak.cur === 4, 'streak across the new year');

  /* ---------- records ---------- */
  const rec = (fp: string, nota: number, date: string, scope = WORLD): NeteroRecord => ({ fp, scope, nota, precision: 1, ritmo: 1, nodes: 1, firstTry: 1, thinkMs: 1, totalMs: 1, fails: 0, lines: 1, date, device: 'pc' });
  let rs = applyRecord([], rec('aaaaaaaaaaaaaaaaaaaaaa', 80, '2026-11-01'));
  check(rs.isRecord && rs.records.length === 1, 'first result is the record');
  rs = applyRecord(rs.records, rec('aaaaaaaaaaaaaaaaaaaaaa', 80, '2026-11-02'));
  check(!rs.isRecord && rs.records[0].date === '2026-11-01', 'a tie does not replace');
  rs = applyRecord(rs.records, rec('aaaaaaaaaaaaaaaaaaaaaa', 80.4, '2026-11-03'));
  check(rs.isRecord && rs.prev?.nota === 80 && rs.records.length === 1, 'a higher nota (even below the next whole number) replaces');
  rs = applyRecord(rs.records, rec('bbbbbbbbbbbbbbbbbbbbbb', 50, '2026-11-04'));
  check(rs.isRecord && rs.records.length === 2, 'new content starts a new version');
  let rf = recordFor(rs.records, WORLD, 'bbbbbbbbbbbbbbbbbbbbbb');
  check(rf.current?.nota === 50 && rf.previous?.nota === 80.4, 'current record and previous version');
  for (let i = 0; i < 10; i++) rs = applyRecord(rs.records, rec(`v${i}`.padEnd(22, 'x'), 10, `2026-11-1${i}`));
  check(rs.records.length === NETERO.keepVersions, 'old versions are dropped');
  const chap = { kind: 'rep' as const, id: 'old-id', name: 'Benko Principal' };
  rf = recordFor([rec('cccccccccccccccccccccc', 70, '2026-10-01', chap)], { kind: 'rep', id: 'new-id', name: 'Benko Principal' }, 'dddddddddddddddddddddd');
  check(rf.previous?.nota === 70 && !rf.current, 'chapter uploaded again (new id, same name): previous version found');

  /* ---------- queue and best times ---------- */
  check(JSON.stringify(nextQueue(['a1a1a1', 'b2b2b2', 'c3c3c3'], ['d4d4d4', 'b2b2b2'], ['a1a1a1'])) === JSON.stringify(['d4d4d4', 'b2b2b2', 'c3c3c3']), 'queue: failed first, clean lines leave');
  const best = nextBest({ aaaaaa: 2000 }, [{ k: 'aaaaaa', ms: 2500 }, { k: 'bbbbbb', ms: 1800 }]);
  check(best.aaaaaa === 2000 && best.bbbbbb === 1800 && nextBest(best, [{ k: 'aaaaaa', ms: 1500 }]).aaaaaa === 1500, 'best: only lower times replace');

  /* ---------- plans ---------- */
  const keys = benko.map(lineKey);
  let plan = planFull(reps, new Set(), WORLD, seeded(1));
  check(plan.lines.length === 3 && plan.eligible && plan.fp === scopeFingerprint(benko.map((line) => ({ color: 'b' as const, line }))), 'full: all lines, eligible, fingerprint');
  const planB = planFull(reps, new Set(), WORLD, seeded(99));
  check(planB.fp === plan.fp && new Set(planB.lines.map((x) => x.key)).size === 3, 'full: order changes, fingerprint does not');
  const partial = planFull(reps, new Set([keys[1]]), WORLD, seeded(1));
  check(partial.lines.length === 2 && !partial.eligible && partial.fp === plan.fp && partial.activeInScope === 2 && partial.inScope === 3, 'full with a line off: practice (no record)');
  const chapter = planFull([...reps, rep('cat', 'Catalana', 'w', [{ id: 'x', event: '', white: 'Cat', black: '', uci: 'd2d4 g8f6 c2c4 e7e6 g2g3' }])], new Set(), { kind: 'rep', id: 'benko1', name: 'Benko Principal' });
  check(chapter.lines.length === 3 && chapter.eligible && chapter.fp === plan.fp, 'chapter scope: only its lines');
  const daily = planDaily(reps, new Set(), 2, [keys[2], 'zzzzzz'], seeded(3));
  check(daily.lines.length === 2 && daily.lines.some((x) => x.key === keys[2]) && !daily.eligible && daily.mode === 'daily', 'daily: queue first, then random');
  check(planDaily(reps, new Set([keys[2]]), 2, [keys[2]], seeded(3)).lines.every((x) => x.key !== keys[2]), 'daily: lines off stay out, even if queued');
  check(planErrors(reps, [keys[0]]).lines.length === 1, 'errors: only the lines given');
  check(userPlies(benko[0], 'b') === 8 && userPlies(benko[0], 'w') === 8 && userPlies(benko[1], 'b') === 5, 'player moves per line');

  /* ---------- a perfect session ---------- */
  let clock = { t: 0 };
  let run = new NeteroRun(plan, 'w1', () => clock.t);
  play(run, clock, () => 1000);
  let live = run.live;
  check(run.status === 'done' && run.fails === 0, 'perfect: finished without fails');
  check(live.nodes === 12, 'nodes: the shared trunk counts once (12 distinct nodes in Benko Principal)');
  check(live.firstTry === 12 && near(live.thinkMs, 12 * 1000) && live.nota === 100, 'perfect at 1 s per node: 100');
  let sum = run.summary('pc', '2026-11-25');
  check(sum.clean.length === 3 && sum.failed.length === 0 && sum.lineMs.length === 3 && sum.lineMs.every((x) => x.ms === 1000), 'perfect: three clean lines, 1 s per move');
  check(run.results.every((r) => r.passes === 1), 'perfect: no repetitions');

  /* ---------- slower: ritmo below 1 ---------- */
  clock = { t: 0 };
  run = new NeteroRun(plan, 'w1', () => clock.t);
  play(run, clock, () => 2500);
  check(near(run.live.ritmo, 0.8) && near(run.live.nota, 80), '2.5 s per node: ritmo 0.8, nota 80');

  /* ---------- a fail on the first move: repetition, and the score ---------- */
  clock = { t: 0 };
  run = new NeteroRun(plan, 'w1', () => clock.t);
  const firstKey = plan.lines[0].key;
  // the very first move of the session (shared trunk, node 1) is first played wrong, after 700 ms
  play(run, clock, () => 1000, (i, pass) => (i === 0 && pass === 1 ? 700 : null));
  live = run.live;
  check(run.fails === 1, 'one fail');
  check(run.results[0].key === firstKey && run.results[0].passes === 2 && !run.results[0].firstClean, 'the line had to be repeated once');
  check(live.nodes === 12 && live.firstTry === 11, 'the repetition adds no nodes: 11 of 12 right');
  // node 1 took 700 ms before the fail + 1000 ms after the glow; the glow itself is left out
  check(near(live.thinkMs, 11 * 1000 + 1700), 'the wrong-move glow is not counted');
  check(near(live.nota, 100 * (11 / 12)), 'nota = 100 × 11/12 (fast enough for ritmo 1)');
  sum = run.summary('movil', '2026-11-25');
  check(sum.failed.length === 1 && sum.failed[0] === firstKey && !sum.clean.includes(firstKey) && sum.clean.length === 2, 'summary: failed and clean lines');
  check(run.failList.length === 1 && run.failList[0].expectedSan === 'Nf6' && run.failList[0].count === 1, 'fail list: the node, with the right move in SAN');
  const n0 = userPlies(plan.lines[0].line, 'b');
  check(sum.lineMs.find((x) => x.k === firstKey)!.ms === Math.round((1700 + (n0 - 1) * 1000) / n0), 'first pass average includes the time of the failed node');

  /* ---------- a fail inside a repetition is a fail, but not a score change ---------- */
  clock = { t: 0 };
  run = new NeteroRun(plan, 'w1', () => clock.t);
  play(run, clock, () => 1000, (i, pass) => ((i === 0 && pass === 1) || (pass === 2 && i === 8) ? 300 : null));
  check(run.fails === 2 && run.results[0].passes === 3 && run.live.firstTry === 11, 'a fail in the repetition forces another one; score unchanged');

  /* ---------- pauses ---------- */
  clock = { t: 0 };
  run = new NeteroRun(plan, 'w1', () => clock.t);
  run.begin();
  if (run.autoDue) { clock.t += 250; run.autoMove(); }
  clock.t += ANIM_MS + 400;
  run.pause();
  clock.t += 60_000;          // a minute away
  check(!run.userTurn && run.userMove(run.expected!).kind === 'ignored', 'paused: no moves');
  run.resume();
  clock.t += 600;
  run.userMove(run.expected!);
  check(near([...run.nodes.values()][0].ms, 1000), 'pause left out of the node time (400 + 600 ms)');
  check(near(run.elapsedMs, 250 + ANIM_MS + 400 + 600), 'pause left out of the session clock');

  /* ---------- hints ---------- */
  clock = { t: 0 };
  run = new NeteroRun(plan, 'w1', () => clock.t);
  run.begin();
  if (run.autoDue) run.autoMove();
  const exp = run.expected!;
  const wrongs = new Chess(run.chess.fen()).moves({ verbose: true }).filter((m) => m.from + m.to !== exp).slice(0, 3);
  check(run.hint() === undefined, 'no hint before trying');
  wrongs.forEach((m) => run.userMove(m.from + m.to));
  check(run.hint() === exp && run.fails === 3, 'the move can be shown after three wrong tries');

  /* ---------- save on the device and resume ---------- */
  clock = { t: 0 };
  run = new NeteroRun(plan, 'w1', () => clock.t);
  run.begin();
  for (let k = 0; k < 7; k++) {
    if (run.autoDue) { clock.t += 250; run.autoMove(); }
    else if (run.userTurn) { clock.t += ANIM_MS + 1000; run.userMove(run.expected!); }
  }
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  const back = NeteroRun.restore(snap, reps, () => clock.t)!;
  check(!!back && back.paused && back.ply === run.ply && back.idx === run.idx && back.chess.fen() === run.chess.fen(), 'restored where it was, paused');
  check(back.live.nodes === run.live.nodes && near(back.elapsedMs, run.elapsedMs), 'restored with its nodes and time');
  back.resume();
  play(back, clock, () => 1000);
  check(back.status === 'done' && back.live.nodes === 12 && back.live.nota === 100, 'resumed session finishes normally');
  check(NeteroRun.restore(snap, [rep('benko1', 'Benko Principal', 'b', benko.slice(1))]) === null, 'a session whose lines are gone cannot be resumed');

  /* ---------- untrusted summaries ---------- */
  const good: NeteroSummary = sum;
  check(!!cleanSummary(good), 'a real summary is accepted');
  check(cleanSummary({ ...good, firstTry: good.nodes + 1 }) === null, 'more right than nodes: refused');
  check(cleanSummary({ ...good, day: '2026-02-30' }) === null, 'impossible date: refused');
  check(cleanSummary({ ...good, mode: 'hack' }) === null, 'unknown mode: refused');
  check(cleanSummary({ ...good, mode: 'full', scope: null }) === null, 'full without scope: refused');
  check(cleanSummary({ ...good, mode: 'daily', eligible: true })!.eligible === false, 'only a full Netero can be eligible');
  check(cleanSummary({ ...good, failed: ['<script>'] }) === null, 'bad line keys: refused');

  /* ---------- server ---------- */
  const kv = memoryKV();
  const app = createApp(async () => kv, hashSecret('Maestra-123', 1 << 12), { lichess: { identify: async (code: string) => ({ id: code.toLowerCase(), username: code }) } });
  const call = (method: string, path: string, body: any = {}, auth?: string, user?: string, ip = '5.5.5.5') => {
    const u = new URL('http://x' + path);
    return app({ method, path: u.pathname, query: u.searchParams, auth: auth ? 'Bearer ' + auth : undefined, user, body, ip });
  };
  const admin = ((await call('POST', '/api/admin/login', { password: 'Maestra-123' })).body as any).token;
  const wid = ((await call('POST', '/api/admin/worlds', { name: 'Benko', password: 'benko-2026' }, admin)).body as any).world.id;
  await call('POST', `/api/admin/worlds/${wid}/reps`, { name: 'Benko Principal', color: 'b', lines: benko }, admin);
  const ut = ((await call('POST', '/api/auth/lichess', { code: 'Netero', verifier: 'v'.repeat(64), redirectUri: 'https://traynsko.vercel.app/' })).body as any).token;
  const wt = ((await call('POST', '/api/enter', { password: 'benko-2026' }, undefined, ut)).body as any).entries[0].token;
  const guest = ((await call('POST', '/api/enter', { password: 'benko-2026', name: 'Invitado' })).body as any).entries[0].token;
  const content = (await call('GET', '/api/content', {}, wt, ut)).body as any;
  const sreps: Repertoire[] = content.reps;
  const today = new Date().toISOString().slice(0, 10);
  const session = (p: Plan, think: number, fails: (i: number, pass: number) => number | null = () => null) => {
    const c = { t: 0 };
    const r = new NeteroRun(p, wid, () => c.t);
    play(r, c, () => think, fails);
    return r.summary('pc', today);
  };
  const worldScope = { kind: 'world' as const, id: wid, name: 'Benko' };

  let r = await call('GET', '/api/netero', {}, guest);
  check(r.status === 401, 'netero: needs an account');
  r = await call('GET', '/api/netero', {}, wt, ut);
  check(r.status === 200 && (r.body as any).netero.records.length === 0 && (r.body as any).netero.streak.cur === 0, 'netero: empty state');

  const p1 = planFull(sreps, new Set(), worldScope, seeded(5));
  r = await call('POST', '/api/netero', { session: session(p1, 2500) }, wt, ut);
  let res = (r.body as any).result;
  check(r.status === 200 && res.recordable && res.isRecord && Math.round(res.nota) === 80 && res.record?.scope.name === 'Benko', 'netero: first full session sets the record');
  r = await call('POST', '/api/netero', { session: session(p1, 3000) }, wt, ut);
  res = (r.body as any).result;
  check(!res.isRecord && Math.round(res.record.nota) === 80 && Math.round(res.prev.nota) === 80, 'netero: a lower nota keeps the record');
  r = await call('POST', '/api/netero', { session: session(p1, 1000, (i, pass) => (i === 2 && pass === 1 ? 500 : null)) }, wt, ut);
  res = (r.body as any).result;
  const st1 = (r.body as any).netero;
  check(res.isRecord && near(res.record.nota, 100 * 11 / 12), 'netero: a higher nota replaces it');
  check(st1.queue.length === 1 && Object.keys(st1.best).length === 3, 'netero: failed line queued, best times kept');
  // forged: claims a record for a scope whose content does not match
  r = await call('POST', '/api/netero', { session: { ...session(p1, 500), fp: 'f'.repeat(22) } }, wt, ut);
  check(!(r.body as any).result.recordable, 'netero: a fingerprint that does not match the repertoire sets no record');
  // practice: a line off
  const p2 = planFull(sreps, new Set([lineKey(sreps[0].lines[0])]), worldScope, seeded(5));
  r = await call('POST', '/api/netero', { session: session(p2, 500) }, wt, ut);
  check(r.status === 200 && !(r.body as any).result.recordable, 'netero: with a line off it is practice');
  // chapter record, separate from the repertoire's
  const p3 = planFull(sreps, new Set(), { kind: 'rep', id: sreps[0].id, name: sreps[0].name }, seeded(5));
  r = await call('POST', '/api/netero', { session: session(p3, 2000) }, wt, ut);
  res = (r.body as any).result;
  check(res.isRecord && res.record.scope.kind === 'rep' && (r.body as any).netero.records.length === 2, 'netero: chapter record kept apart');
  check((r.body as any).netero.queue.length === 0, 'netero: lines done cleanly leave the review queue');
  // a daily with a fail: the streak starts and the line is queued
  const pd0 = planDaily(sreps, new Set(), 1, [], seeded(8));
  r = await call('POST', '/api/netero', { session: session(pd0, 1000, (i, pass) => (i === 0 && pass === 1 ? 100 : null)) }, wt, ut);
  res = (r.body as any).result;
  const queued = (r.body as any).netero.queue[0];
  check(res.counted && (r.body as any).netero.streak.cur === 1 && queued === pd0.lines[0].key, 'daily: streak starts, the failed line is queued');
  // the next daily takes the queued line first; done cleanly, it leaves the queue
  const pd = planDaily(sreps, new Set(), 1, (r.body as any).netero.queue, seeded(21));
  check(pd.lines[0].key === queued, 'daily: the queued line comes first');
  r = await call('POST', '/api/netero', { session: session(pd, 1000) }, wt, ut);
  check(!(r.body as any).result.counted && (r.body as any).netero.streak.cur === 1, 'daily: a second one the same day does not count');
  check(!(r.body as any).netero.queue.includes(queued), 'daily: the line done cleanly leaves the queue');
  r = await call('POST', '/api/netero', { session: { ...session(pd, 1000), day: '2020-01-01' } }, wt, ut);
  check(r.status === 400, 'netero: a date far from today is refused');
  r = await call('POST', '/api/netero', { session: { nodes: 3 } }, wt, ut);
  check(r.status === 400, 'netero: invalid session refused');
  r = await call('GET', '/api/netero', {}, wt, ut);
  check((r.body as any).netero.records.length === 2 && (r.body as any).netero.streak.best === 1, 'netero: state read back');
  // deleting the account deletes its Netero data
  r = await call('DELETE', '/api/me', {}, undefined, ut);
  check(r.status === 200 && (await kv.get(`tr:nt:${wid}:netero`)) === null && (await kv.get('tr:ns:netero')) === null, 'netero: removed with the account');
  // deleting the repertoire too
  const ut2 = ((await call('POST', '/api/auth/lichess', { code: 'Otra', verifier: 'v'.repeat(64), redirectUri: 'https://traynsko.vercel.app/' })).body as any).token;
  const wt2 = ((await call('POST', '/api/enter', { password: 'benko-2026' }, undefined, ut2)).body as any).entries[0].token;
  await call('POST', '/api/netero', { session: session(p1, 1000) }, wt2, ut2);
  check(!!(await kv.get(`tr:nt:${wid}:otra`)), 'netero: saved for another account');
  await call('DELETE', `/api/admin/worlds/${wid}`, {}, admin);
  check((await kv.get(`tr:nt:${wid}:otra`)) === null, 'netero: removed with the repertoire');

  console.log(`netero: ${ok} ok, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
