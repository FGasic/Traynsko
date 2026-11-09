// Test-only bundle: the previous bots and Trayner choose in the same positions (tests/qa_trayner.py).
import { Engine } from '../../src/lib/engine';
import { Maia } from '../../src/lib/maia';
import { botById, chooseMove } from '../../src/lib/bots';
import { traynerMove } from '../../src/lib/trayner';

(window as any).__compare = async (o: { positions: { fens: string[] }[]; elos: number[]; ms: number; worker: string; model: string; old: string }) => {
  const engine = new Engine();
  const maia = new Maia(o.worker, o.model);
  await Promise.all([engine.ready, maia.load()]);
  const out: any[] = [];
  for (const pos of o.positions) {
    const fen = pos.fens[pos.fens.length - 1];
    for (const elo of o.elos) {
      const cands = await engine.search(fen, o.ms);
      const best = Math.max(...cands.map((c) => c.cp));
      const oldUci = chooseMove(fen, cands, botById(o.old), elo);
      const oldLoss = best - cands.find((c) => c.uci === oldUci)!.cp;
      const t = await traynerMove({ engine, maia, fens: pos.fens, elo, avgMs: o.ms, clockMs: 600_000, freePlies: 10, waitMs: 0, stale: () => false, thinkMs: o.ms * 1.2 });
      const row = t.table.find((r) => r.uci === t.uci);
      const maiaTop = t.table.length ? t.table.reduce((x, y) => (y.p > x.p ? y : x)).uci : t.uci;
      out.push({ fen, elo, engineBest: cands.reduce((x, y) => (y.cp > x.cp ? y : x)).uci, old: oldUci, oldLoss, trayner: t.uci, traynerLoss: row ? row.seen + row.hidden : 0, why: t.why, maiaTop, maiaMs: t.maiaMs });
    }
  }
  engine.destroy(); maia.destroy();
  return out;
};
