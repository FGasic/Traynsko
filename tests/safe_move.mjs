// Test helper: prints a quiet move (UCI) for the side to move that hangs nothing, preferring positions not seen yet.
// Usage: node tests/safe_move.mjs "<fen>" "<seen position keys separated by |>"
import { Chess } from 'chess.js';
const [fen, seenRaw = ''] = process.argv.slice(2);
const seen = new Set(seenRaw.split('|').filter(Boolean));
const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const key = (f) => f.split(' ').slice(0, 4).join(' ');
const c = new Chess(fen);
function hangs() {
  // any opponent capture that wins material even after our best recapture on that square
  for (const r of c.moves({ verbose: true })) {
    if (!r.captured) continue;
    c.move(r);
    const back = c.moves({ verbose: true }).some((x) => x.to === r.to && x.captured);
    c.undo();
    if (V[r.captured] - (back ? V[r.piece] : 0) > 0) return true;
  }
  return false;
}
const ok = [];
for (const m of c.moves({ verbose: true })) {
  if (m.captured || m.promotion) continue;
  c.move(m);
  const bad = hangs() || c.moves().some((x) => x.includes('#'));
  const k = key(c.fen());
  c.undo();
  if (!bad) ok.push({ m, k, fresh: !seen.has(k) });
}
const pick = ok.find((x) => x.fresh) ?? ok[0];
console.log(pick ? `${pick.m.from}${pick.m.to} ${pick.k}` : 'none');
