// Pure checks of Trayner's choice (human.ts) and of the Maia encoding (maia.ts).
import { chooseHuman, consideredMoves, humanParams, thinkTime, type HumanInput } from '../src/lib/human';
import { boardPlanes, historyTokens, maiaElo, moveIndex } from '../src/lib/maia';
import { humanScores } from '../src/lib/trayner';

let ok = 0, bad = 0;
const check = (cond: boolean, msg: string) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };

/** A seeded generator, so the frequencies below are stable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
/** How often each move is chosen over n draws. */
function freq(inp: HumanInput, n = 4000, seed = 1) {
  const r = rng(seed), out: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const u = chooseHuman(inp, r).uci; out[u] = (out[u] ?? 0) + 1 / n; }
  return out;
}
const M = (o: Record<string, number>) => new Map(Object.entries(o));
const pol = (o: Record<string, number>) => Object.entries(o).map(([uci, p]) => ({ uci, p })).sort((a, b) => b.p - a.p);

/* ---------- encoding ---------- */
{
  const start = boardPlanes('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  check(start[0 * 12 + 3] === 1 && start[4 * 12 + 5] === 1 && start[60 * 12 + 11] === 1, 'start: Ra1, Ke1 white; Ke8 black');
  // after 1.e4 Black is to move: mirrored, so Black's king is on e1 as "white"
  const e4 = boardPlanes('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  check(e4[4 * 12 + 5] === 1 && e4[60 * 12 + 11] === 1, 'black to move: own king on e1, the other on e8');
  check(e4[(4 * 8 + 4) * 12 + 6] === 1, 'black to move: the e4 pawn shows as an opposing pawn on e5');
  check(start.reduce((a, b) => a + b, 0) === 32, '32 pieces, one channel each');
  check(moveIndex('e2e4', false) === 12 * 64 + 28, 'e2e4 = 12·64 + 28');
  check(moveIndex('e7e5', true) === moveIndex('e2e4', false), 'Black’s e7e5 is White’s e2e4 mirrored');
  check(moveIndex('a7a8q', false) === 4096 && moveIndex('b7a8n', false) === 4096 + 8 * 4 + 3, 'promotions after the 4096 plain moves');
  check(moveIndex('a2a1q', true) === 4096, 'Black promotion, mirrored');
  const h = historyTokens(['8/8/8/8/8/8/8/K6k w - - 0 1']);
  check(h.length === 64 * 96 && h[0 * 96 + 7 * 12 + 5] === 1 && h[0 * 96 + 5] === 1, 'one position fills the 8 history slots');
  check(maiaElo(1800) === 2100 && maiaElo(2300) === 2510 && maiaElo(2800) === 2700, `rating scale: 1800→2100, 2300→2510, cap 2700 (${maiaElo(2300)})`);
}

/* ---------- choosing ---------- */
// 1. Recapture: the network is sure and the engine agrees.
{
  const f = freq({ policy: pol({ d7c6: 0.85, b7c6: 0.14, e8e7: 0.01 }), best: { uci: 'd7c6', cp: 10 }, deep: M({ d7c6: 10, b7c6: -5, e8e7: -320 }), shallow: M({ d7c6: 12, b7c6: 0, e8e7: -300 }), elo: 2000 });
  check(f.d7c6 > 0.7 && (f.e8e7 ?? 0) === 0, `recapture played, the blunder never (${JSON.stringify(f)})`);
}
// 2. A piece left hanging (visible at once): taking it is what a 2000 player does.
{
  const f = freq({ policy: pol({ g1f3: 0.5, c1g5: 0.3, d4e5: 0.2 }), best: { uci: 'c1g5', cp: 820 }, deep: M({ g1f3: 0, c1g5: 820, d4e5: 30 }), shallow: M({ g1f3: 0, c1g5: 830, d4e5: 30 }), elo: 2000 });
  check(f.c1g5 > 0.97, `takes the hanging queen (${JSON.stringify(f)})`);
}
// 3. A win that only a deep search finds: at 2000 it is often missed, at 2700 rarely.
{
  const base = { policy: pol({ a2a3: 0.45, h2h3: 0.35, f3g5: 0.2 }), best: { uci: 'f3g5', cp: 400 }, deep: M({ a2a3: 20, h2h3: 15, f3g5: 400 }), shallow: M({ a2a3: 20, h2h3: 15, f3g5: 10 }) };
  const low = freq({ ...base, elo: 2000 }), high = freq({ ...base, elo: 2700 });
  check(low.f3g5 < 0.5 && (low.a2a3 ?? 0) + (low.h2h3 ?? 0) > 0.5, `2000: the deep shot is often missed (${JSON.stringify(low)})`);
  check(high.f3g5 > low.f3g5 + 0.2, `2700 finds it much more often (${JSON.stringify(high)})`);
}
// 4. A move that loses to a deep tactic stays possible at 2000 (a human error), not at 2700.
{
  const base = { policy: pol({ e4e5: 0.6, d2d3: 0.4 }), best: { uci: 'd2d3', cp: 30 }, deep: M({ e4e5: -330, d2d3: 30 }), shallow: M({ e4e5: 40, d2d3: 30 }) };
  const low = freq({ ...base, elo: 2000 }), high = freq({ ...base, elo: 2750 });
  check((low.e4e5 ?? 0) > 0.1, `2000 sometimes falls for the deep tactic (${JSON.stringify(low)})`);
  check((high.e4e5 ?? 0) < 0.03, `2750 almost never (${JSON.stringify(high)})`);
}
// 5. A short forced mate is always found; one beyond sight at 1800 is not forced.
{
  const mateIn2 = 100000 - 2 * 100;
  const r = chooseHuman({ policy: pol({ a1a2: 0.9, h5h7: 0.1 }), best: { uci: 'h5h7', cp: mateIn2 }, deep: M({ a1a2: 0, h5h7: mateIn2 }), shallow: M({ a1a2: 0, h5h7: 0 }), elo: 1800 }, rng(3));
  check(r.uci === 'h5h7' && r.why === 'mate', 'mate in 2 found at 1800');
}
// 6. Walking into a visible mate never happens.
{
  const f = freq({ policy: pol({ g7g5: 0.7, e7e6: 0.3 }), best: { uci: 'e7e6', cp: -20 }, deep: M({ g7g5: -(100000 - 100), e7e6: -20 }), shallow: M({ g7g5: -(100000 - 100), e7e6: -20 }), elo: 1800 });
  check((f.g7g5 ?? 0) === 0, `never allows mate in one (${JSON.stringify(f)})`);
}
// 7. Very high levels follow the engine even when the network prefers something else.
{
  const f = freq({ policy: pol({ a2a3: 0.7, c2c4: 0.3 }), best: { uci: 'c2c4', cp: 60 }, deep: M({ a2a3: -40, c2c4: 60 }), shallow: M({ a2a3: -40, c2c4: 60 }), elo: 2800 });
  check(f.c2c4 > 0.9, `2800 plays the clearly better move (${JSON.stringify(f)})`);
  const g = freq({ policy: pol({ a2a3: 0.7, c2c4: 0.3 }), best: { uci: 'c2c4', cp: 60 }, deep: M({ a2a3: 20, c2c4: 60 }), shallow: M({ a2a3: 20, c2c4: 60 }), elo: 1900 });
  check(g.a2a3 > 0.4, `1900 often plays the natural, slightly worse move (${JSON.stringify(g)})`);
}
// 8. Every option a visible error: the least bad as seen.
{
  const r = chooseHuman({ policy: pol({ a1a2: 0.6, b1b2: 0.4 }), best: { uci: 'c1c2', cp: 500 }, deep: M({ a1a2: -500, b1b2: -300, c1c2: 500 }), shallow: M({ a1a2: -500, b1b2: -300, c1c2: 500 }), elo: 2000 }, rng(5));
  check(r.uci === 'c1c2', `when every considered move is a visible blunder, the engine move (${r.uci}, ${r.why})`);
}
// 9. Considered moves: likeliest first, up to 95 % or 8 moves.
{
  check(consideredMoves(pol({ a: 0.97, b: 0.02, c: 0.01 })).join() === 'a', 'one sure move');
  check(consideredMoves(pol({ a: 0.4, b: 0.3, c: 0.2, d: 0.06, e: 0.04 })).join() === 'a,b,c,d', 'until 95 %');
  check(consideredMoves(Array.from({ length: 30 }, (_, i) => ({ uci: 'm' + i, p: 1 / 30 }))).length === 8, 'never more than 8');
}
// 10. Parameters move in the right direction.
{
  const a = humanParams(1800), b = humanParams(2300), c = humanParams(2800);
  check(a.visibleCap > b.visibleCap && b.visibleCap > c.visibleCap, 'tolerance shrinks with level');
  check(a.depthSeen < c.depthSeen && a.hiddenTemp > b.hiddenTemp && b.hiddenTemp > 4 * c.hiddenTemp, 'sees deeper, and what it can’t see weighs more, with level');
  check(a.policyExp === 1 && b.policyExp === 1 && c.policyExp < 0.3, 'engine weight only above ~2350');
}
// 11. Thinking time: short when obvious, longer when unclear, short when the clock is low.
{
  const r = rng(9);
  const avg = (o: any) => { let s = 0; for (let i = 0; i < 400; i++) s += thinkTime(o, r); return s / 400; };
  const base = { legal: 30, avgMs: 3000, clockMs: 600_000, freePlies: 10 };
  const obvious = avg({ ...base, top: 0.95 }), unclear = avg({ ...base, top: 0.2 });
  check(obvious < 1300 && unclear > 4000, `obvious ≈${obvious.toFixed(0)} ms, unclear ≈${unclear.toFixed(0)} ms`);
  check(avg({ ...base, top: 0.2, clockMs: 15_000 }) <= 900, 'fast when short of time');
  check(avg({ ...base, top: 0.2, legal: 1 }) <= 500, 'a forced move is quick');
}
// 12. Deep and shallow scores from the two searches.
{
  const a = { cands: [{ uci: 'e2e4', cp: 40, depth: 18 }, { uci: 'd2d4', cp: 35, depth: 18 }], byDepth: new Map([['e2e4', new Map([[4, 30], [18, 40]])]]), depth: 18 };
  const b = { cands: [{ uci: 'e2e4', cp: 30, depth: 12 }, { uci: 'a2a3', cp: -10, depth: 12 }], byDepth: new Map([['e2e4', new Map([[4, 25], [12, 30]])], ['a2a3', new Map([[3, 0], [12, -10]])]]), depth: 12 };
  const { deep, shallow } = humanScores(a, b, a.cands[0], ['e2e4', 'a2a3'], 4);
  check(deep.get('e2e4') === 40 && deep.get('a2a3') === 0, `deep: the deeper search, the other one shifted to match (${[...deep]})`);
  check(shallow.get('e2e4') === 25 && shallow.get('a2a3') === 0, `shallow: depth 4, or the nearest below (${[...shallow]})`);
}

console.log(`human: ${ok} ok, ${bad} failed`);
if (bad) process.exit(1);
