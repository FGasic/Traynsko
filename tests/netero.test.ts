// Modo Netero: scoring and records (shared), the session engine, and the server's endpoints (records, Top 3).
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import {
  NETERO, applyRecord, cleanSummary, neteroScore, nextBest, nextQueue, recordFor, scopeFingerprint, topOf, updateTop,
  type NeteroRecord, type NeteroSummary,
} from '../shared/netero';
import { lineKey } from '../shared/picks';
import { ANIM_MS, WRONG_MS, NeteroRun, drawPause, lineNodes, planCampaign, planDaily, planErrors, planFromKeys, planFull, userPlies, type Plan } from '../src/lib/netero';
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

/** Like `play`, noting where each pass of each line started: its first asked node and the autopilot's end. */
function track(run: NeteroRun, clock: { t: number }, think: (i: number) => number, fail: (i: number, pass: number) => number | null = () => null) {
  const starts: { idx: number; pass: number; start: number; auto: number }[] = [];
  const note = () => starts.push({ idx: run.idx, pass: run.pass, start: run.lineStartIdx, auto: run.autoUntil });
  note();
  const next = run.next.bind(run);
  run.next = () => { const s = next(); if (s && s !== 'finish') note(); return s; };
  play(run, clock, think, fail);
  return starts;
}

(async () => {
  /* ---------- scoring ---------- */
  let s = neteroScore(12, 11, 12 * 2500);
  check(near(s.precision, 11 / 12) && near(s.ritmo, 0.8) && Math.round(s.nota) === 73, 'spec example: 12 nodes, 11 right, 2.5 s → 73');
  s = neteroScore(10, 10, 10 * 1500);
  check(s.ritmo === 1 && s.nota === 100, 'faster than t100 scores 100');
  check(neteroScore(0, 0, 0).nota === 0, 'no nodes, no score');
  check(NETERO.t100Ms === 2000, 'parameters as specified');

  /* ---------- Top 3 tables ---------- */
  let tb = updateTop({}, 'ana', { name: 'Ana', nota: 80, device: 'pc', date: '2026-11-01' }).table;
  tb = updateTop(tb, 'luis', { name: 'Luis', nota: 90, device: 'movil', date: '2026-11-02' }).table;
  check(!updateTop(tb, 'ana', { name: 'Ana', nota: 79, device: 'pc', date: '2026-11-03' }).changed, 'top: a lower nota does not replace the person\'s best');
  tb = updateTop(tb, 'ana', { name: 'Ana', nota: 85, device: 'pc', date: '2026-11-03' }).table;
  tb = updateTop(tb, 'eva', { name: 'Eva', nota: 70, device: 'pc', date: '2026-11-04' }).table;
  tb = updateTop(tb, 'teo', { name: 'Teo', nota: 60, device: 'pc', date: '2026-11-05' }).table;
  let tp = topOf(tb, new Set());
  check(tp.n === 4 && tp.top.map((t) => t.id).join() === 'luis,ana,eva', 'top: three best, one entry per person');
  tp = topOf(tb, new Set(['luis']));
  check(tp.n === 3 && tp.top[0].id === 'ana', 'top: people who hide are left out (and not counted)');

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
  const daily = planCampaign(reps, new Set(), [keys[2], 'zzzzzz'], 2, seeded(3));
  check(daily.lines.length === 2 && daily.lines.some((x) => x.key === keys[2]) && !daily.eligible && daily.mode === 'campaign', 'campaign memory: queue first, then random');
  check(planDaily(reps, new Set([keys[2]]), 2, [keys[2]], seeded(3)).lines.every((x) => x.key !== keys[2]), 'campaign memory: lines off stay out, even if queued');
  check(planCampaign(reps, new Set(), []).lines.length === 3, 'campaign memory: 3 lines by default');
  const again = planFromKeys(reps, [keys[0], keys[1]], 'campaign');
  check(again.mode === 'campaign' && again.lines.length === 2, 'campaign memory: the same lines again from their keys');
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

  /* ---------- v1.1: autopilot, pause and repetition near the fail ---------- */
  check(drawPause(() => 0) === 5 && drawPause(() => 0.9999) === 9, 'k is drawn between 5 and 9');
  // Benko Principal: trunks of 3–4 of the player's moves, under the threshold: every line is asked from the first move
  {
    const c = { t: 0 };
    const r = new NeteroRun(plan, 'w1', () => c.t, seeded(4));
    const st = track(r, c, () => 1000);
    check(st.filter((x) => x.pass === 1).every((x) => x.start === 0 && x.auto === 0), 'short trunks: asked from the first move (as in v1)');
  }
  // a Sveshnikov trunk up to 9.Bxf6 gxf6 (9 moves of Black) and ten lines that leave it at move 10
  const TRUNK = 'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6 c1g5 a7a6 b5a3 b7b5 g5f6 g7f6';
  const trunkPos = new Chess();
  for (const u of TRUNK.split(' ')) trunkPos.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  const tenth = trunkPos.moves({ verbose: true }).slice(0, 10).map((m) => m.from + m.to + (m.promotion ?? ''));
  const sveshLines: Line[] = tenth.map((w, i) => {
    const c2 = new Chess(trunkPos.fen());
    c2.move({ from: w.slice(0, 2), to: w.slice(2, 4) });
    const b = c2.moves({ verbose: true })[0];
    return { id: `s${i}`, event: 'Sveshnikov', white: `10.${w}`, black: '', uci: `${TRUNK} ${w} ${b.from}${b.to}${b.promotion ?? ''}` };
  });
  const svesh = [rep('svesh', 'Sveshnikov', 'b', sveshLines)];
  const fixed = (lines: Line[]): Plan => {
    const items = lines.map((line) => ({ key: lineKey(line), rep: svesh[0], line }));
    return { mode: 'errors', scope: null, fp: null, eligible: false, lines: items, inScope: items.length, activeInScope: items.length };
  };
  check(lineNodes(sveshLines[0], 'b').length === 10 && lineNodes(sveshLines[0], 'b')[9].ply === 19, 'nodes of a line: 9 of the trunk + 1, the 10th at ply 19');
  for (const seed of [1, 2, 3, 7, 11]) {
    const c = { t: 0 };
    const p10 = planFull(svesh, new Set(), { kind: 'rep', id: 'svesh', name: 'Sveshnikov' }, seeded(seed));
    const r = new NeteroRun(p10, 'w1', () => c.t, seeded(seed * 13));
    const st = track(r, c, () => 1000).filter((x) => x.pass === 1);
    const full = st.map((x, i) => (x.start === 0 ? i : -1)).filter((i) => i >= 0);
    const rest = st.filter((x) => x.start !== 0);
    check(full.length === 2 && full[0] === 0 && full[1] >= 5 && full[1] <= 9, `ten lines (seed ${seed}): the trunk is asked in the 1st line and again in one of the 6th–10th`);
    check(rest.every((x) => x.start === 9 && x.auto === 19), `ten lines (seed ${seed}): the others play the trunk themselves and ask from move 10`);
    check(r.live.nodes === 19 && r.live.firstTry === 19 && near(r.live.thinkMs, 19 * 1000) && r.live.nota === 100, `ten lines (seed ${seed}): 19 nodes, each scored once (the trunk asked again does not count)`);
    const sm = r.summary('pc', '2026-11-26');
    check(sm.lineMs.length === 2 && sm.clean.length === 10, `ten lines (seed ${seed}): best times only from the lines asked from the first move`);
  }
  // a fail in the trunk: the repetition starts 2 moves before it; the next line asks from the failed node
  {
    const c = { t: 0 };
    const r = new NeteroRun(fixed(sveshLines.slice(0, 3)), 'w1', () => c.t, seeded(5));
    const st = track(r, c, () => 1000, (i, pass) => (i === 6 && pass === 1 ? 300 : null));
    const rep1 = st.find((x) => x.idx === 0 && x.pass === 2);
    const line2 = st.find((x) => x.idx === 1 && x.pass === 1);
    const line3 = st.find((x) => x.idx === 2 && x.pass === 1);
    check(!!rep1 && rep1.auto === 9, 'repetition: starts 2 of the player\'s moves before the fail (node 4, ply 9)');
    check(!!line2 && line2.start === 6 && line2.auto === 13, 'next line: plays itself up to the failed node, and asks from there');
    check(!!line3 && line3.start === 9, 'once right again, the failed node is paused too');
    check(r.fails === 1 && r.live.firstTry === 11 && r.live.nodes === 12, 'score: the failed node stays failed (first appearance only)');
  }
  // a fail at the new move of a line that skipped its trunk: the repetition does not go back past the line's start
  {
    const c = { t: 0 };
    const r = new NeteroRun(fixed(sveshLines.slice(0, 2)), 'w1', () => c.t, seeded(5));
    const st = track(r, c, () => 1000, (i, pass) => (i === 10 && pass === 1 ? 300 : null));
    const rep2 = st.find((x) => x.idx === 1 && x.pass === 2);
    check(!!rep2 && rep2.auto === 19, 'repetition: never before the line\'s start');
    check(r.summary('pc', '2026-11-26').failed.length === 1, 'the line with the fail is reported');
  }
  // a line with nothing new (it ends with a rival move already seen): asks at least its last move
  {
    const c = { t: 0 };
    const prefix: Line = { ...sveshLines[0], id: 'pre', uci: sveshLines[0].uci.split(' ').slice(0, 19).join(' ') };
    const r = new NeteroRun(fixed([sveshLines[0], prefix]), 'w1', () => c.t, seeded(5));
    const st = track(r, c, () => 1000);
    const l2 = st.find((x) => x.idx === 1 && x.pass === 1);
    check(!!l2 && l2.start === 8 && l2.auto === 17 && r.status === 'done', 'all known: the line asks its last move');
  }
  // the autopilot is not timed, and it survives closing the app
  {
    const c = { t: 0 };
    const r = new NeteroRun(fixed(sveshLines.slice(0, 2)), 'w1', () => c.t, seeded(5));
    r.begin();
    for (let g = 0; g < 200 && !(r.idx === 1 && r.status === 'play' && r.ply === 6); g++) {
      if (r.status === 'between') { c.t += 900; r.next(); }
      else if (r.autoDue) { c.t += 250; r.autoMove(); }
      else if (r.userTurn) { c.t += ANIM_MS + 1000; r.userMove(r.expected!); }
    }
    check(r.inAutopilot && !r.userTurn && r.autoDue && r.userMove('e7e5').kind === 'ignored', 'autopilot: the board takes no moves');
    const memoSize = r.memo.size;
    const snap2 = JSON.parse(JSON.stringify(r.snapshot()));
    check(snap2.v === 2 && snap2.autoUntil === 19, 'snapshot keeps the autopilot');
    const back2 = NeteroRun.restore(snap2, svesh, () => c.t)!;
    check(!!back2 && back2.autoUntil === 19 && back2.memo.size === memoSize && back2.lineStartIdx === 9, 'restored with its autopilot');
    back2.resume();
    play(back2, c, () => 1000);
    check(back2.status === 'done' && back2.live.nodes === 11 && near(back2.live.thinkMs, 11 * 1000), 'resumed: the autopilot finishes, untimed');
    const v1 = { ...snap2, v: 1 };
    for (const k of ['autoUntil', 'lineStartIdx', 'repeatIdx', 'firstFailIdx', 'passK', 'memo']) delete v1[k];
    const old = NeteroRun.restore(v1, svesh, () => c.t);
    check(!!old && old.autoUntil === 0 && old.memo.size === 0, 'a session saved before v1.1 resumes, asking everything');
  }

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
  check(r.status === 200 && (r.body as any).netero.records.length === 0 && Object.keys((r.body as any).netero.tops).length === 0, 'netero: empty state');

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
  // the Campaign's memory phase with a fail: the line is queued, no record
  const pd0 = planCampaign(sreps, new Set(), [], 1, seeded(8));
  r = await call('POST', '/api/netero', { session: session(pd0, 1000, (i, pass) => (i === 0 && pass === 1 ? 100 : null)) }, wt, ut);
  res = (r.body as any).result;
  const queued = (r.body as any).netero.queue[0];
  check(!res.recordable && queued === pd0.lines[0].key, 'campaign memory: no record, the failed line is queued');
  // the next memory phase takes the queued line first; done cleanly, it leaves the queue
  const pd = planCampaign(sreps, new Set(), (r.body as any).netero.queue, 1, seeded(21));
  check(pd.lines[0].key === queued, 'campaign memory: the queued line comes first');
  r = await call('POST', '/api/netero', { session: session(pd, 1000) }, wt, ut);
  check(!(r.body as any).netero.queue.includes(queued), 'campaign memory: the line done cleanly leaves the queue');
  // an older app's daily Netero is still accepted, as practice
  r = await call('POST', '/api/netero', { session: { ...session(pd, 1000), mode: 'daily' } }, wt, ut);
  check(r.status === 200 && !(r.body as any).result.recordable, 'an old daily Netero is practice');
  r = await call('POST', '/api/netero', { session: { ...session(pd, 1000), day: '2020-01-01' } }, wt, ut);
  check(r.status === 400, 'netero: a date far from today is refused');
  r = await call('POST', '/api/netero', { session: { nodes: 3 } }, wt, ut);
  check(r.status === 400, 'netero: invalid session refused');
  r = await call('GET', '/api/netero', {}, wt, ut);
  check((r.body as any).netero.records.length === 2, 'netero: state read back');
  // Top 3: only this account so far (shown from two people on)
  const wfp = p1.fp!;
  let top = (r.body as any).netero.tops['world:' + wfp];
  check(top?.n === 1 && top.top[0].name === 'Netero' && Math.round(top.top[0].nota) === 92, 'top: the best nota of the account (not every session)');
  // a second account in the same repertoire
  const ub = ((await call('POST', '/api/auth/lichess', { code: 'Bea', verifier: 'v'.repeat(64), redirectUri: 'https://traynsko.vercel.app/' })).body as any).token;
  const wb = ((await call('POST', '/api/enter', { password: 'benko-2026' }, undefined, ub)).body as any).entries[0].token;
  await call('POST', '/api/netero', { session: session(p1, 1500) }, wb, ub);
  r = await call('GET', '/api/netero', {}, wt, ut);
  top = (r.body as any).netero.tops['world:' + wfp];
  check(top.n === 2 && top.top[0].name === 'Bea' && top.top[1].name === 'Netero', 'top: two people, best first');
  // Bea leaves the rankings: she disappears (and her records stay)
  r = await call('PATCH', '/api/me', { hideRank: true }, undefined, ub);
  check(r.status === 200 && (r.body as any).hideRank === true, 'me: hide from rankings');
  r = await call('GET', '/api/me', {}, undefined, ub);
  check((r.body as any).hideRank === true, 'me: the choice is kept');
  r = await call('GET', '/api/netero', {}, wt, ut);
  top = (r.body as any).netero.tops['world:' + wfp];
  check(top.n === 1 && top.top[0].name === 'Netero', 'top: a hidden person is left out');
  r = await call('GET', '/api/netero', {}, wb, ub);
  check((r.body as any).netero.records.length === 1, 'top: hiding keeps your records');
  r = await call('PATCH', '/api/me', { hideRank: 'x' }, undefined, ub);
  check(r.status === 400, 'me: hideRank must be true or false');
  await call('PATCH', '/api/me', { hideRank: false }, undefined, ub);
  // deleting the account deletes its Netero data
  r = await call('DELETE', '/api/me', {}, undefined, ut);
  check(r.status === 200 && (await kv.get(`tr:nt:${wid}:netero`)) === null, 'netero: removed with the account');
  r = await call('GET', '/api/netero', {}, wb, ub);
  top = (r.body as any).netero.tops['world:' + wfp];
  check(top.n === 1 && top.top[0].name === 'Bea', 'top: a deleted account leaves the Top 3');
  // deleting the repertoire too
  const ut2 = ((await call('POST', '/api/auth/lichess', { code: 'Otra', verifier: 'v'.repeat(64), redirectUri: 'https://traynsko.vercel.app/' })).body as any).token;
  const wt2 = ((await call('POST', '/api/enter', { password: 'benko-2026' }, undefined, ut2)).body as any).entries[0].token;
  await call('POST', '/api/netero', { session: session(p1, 1000) }, wt2, ut2);
  check(!!(await kv.get(`tr:nt:${wid}:otra`)), 'netero: saved for another account');
  await call('DELETE', `/api/admin/worlds/${wid}`, {}, admin);
  check((await kv.get(`tr:nt:${wid}:otra`)) === null && Object.keys(await kv.hgetall(`tr:ntop:${wid}`)).length === 0, 'netero: removed with the repertoire (and its Top 3)');

  console.log(`netero: ${ok} ok, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
