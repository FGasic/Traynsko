/**
 * One move of Trayner, the human-style bot: the network proposes (maia.ts), the engine checks what is seen
 * and what is real, human.ts decides. Shared by the game session and the automated comparisons.
 */
import type { Candidate } from './bots';
import type { Analysis, Engine } from './engine';
import { maiaElo, type Maia } from './maia';
import { chooseHuman, consideredMoves, humanParams, searchTime, thinkTime, type HumanChoice } from './human';

/** A jump of at least this much in the bot's favour since its last move: the player gave material away. */
const GIFT_CP = 200;

export interface TraynerMove {
  uci: string;
  /** the engine's evaluation of the position, from the bot's side (for draw offers) */
  botEval: number;
  /** how long it "thinks" in total, network included */
  thinkMs: number;
  maiaMs: number;
  /** the network's probability for its likeliest move */
  top: number;
  why: HumanChoice['why'];
  table: HumanChoice['table'];
}

export async function traynerMove(o: {
  engine: Engine; maia: Maia; fens: string[]; elo: number; avgMs: number; clockMs: number; freePlies: number;
  /** how long to wait for the network if it is still loading */
  waitMs: number;
  /** true once the position has changed (the game moved on): stop */
  stale(): boolean;
  /** the bot's evaluation after its previous move (its side), to notice material given away */
  prevEval?: number | null;
  /** the player's last thinking time, and their usual one in this game */
  userMs?: number;
  userTypicalMs?: number;
  /** fixed thinking time, for comparisons (it also fixes the search, as before) */
  thinkMs?: number;
  rnd?: () => number;
}): Promise<TraynerMove> {
  const fen = o.fens[o.fens.length - 1];
  const t0 = performance.now();
  const policy = await o.maia.policy(o.fens.slice(-8), maiaElo(o.elo), maiaElo(o.elo), o.waitMs);
  const maiaMs = Math.round(performance.now() - t0);
  if (o.stale()) throw new Error('stale');
  const top = policy.moves[0]?.p ?? 1;
  const legal = policy.moves.length;
  // the search never depends on the thinking time shown: thinking longer doesn't play stronger
  const search = o.thinkMs !== undefined ? o.thinkMs * 0.85 : searchTime({ top, legal, avgMs: o.avgMs, clockMs: o.clockMs });
  const a = await o.engine.analyse(fen, Math.max(250, search * 0.65));
  if (o.stale()) throw new Error('stale');
  const best = a.cands.reduce((x, y) => (y.cp > x.cp ? y : x));
  const set = [...new Set([...consideredMoves(policy.moves), best.uci])];
  const b = await o.engine.analyse(fen, Math.max(200, search * 0.35), set);
  if (o.stale()) throw new Error('stale');
  const { deep, shallow } = humanScores(a, b, best, set, humanParams(o.elo).depthSeen);
  const choice = chooseHuman({ policy: policy.moves, best: { uci: best.uci, cp: best.cp }, deep, shallow, elo: o.elo }, o.rnd);
  const gift = o.prevEval != null && best.cp - o.prevEval >= GIFT_CP;
  const think = o.thinkMs ?? thinkTime({
    top, legal, avgMs: o.avgMs, clockMs: o.clockMs, freePlies: o.freePlies,
    evalCp: best.cp, gift, userMs: o.userMs, userTypicalMs: o.userTypicalMs,
  }, o.rnd);
  return { uci: choice.uci, botEval: best.cp, thinkMs: think + maiaMs, maiaMs, top, why: choice.why, table: choice.table };
}

/**
 * Deep and shallow scores of the moves Trayner considers. The unrestricted search (a) is the deeper one: its
 * score is used when it has the move; otherwise the restricted search (b), shifted so both agree on the best move.
 * The shallow score is each move's score at `depth` in (b), where every considered move is reported.
 */
export function humanScores(a: Analysis, b: Analysis, best: Candidate, set: string[], depth: number) {
  const aCp = new Map(a.cands.map((c) => [c.uci, c.cp]));
  const bCp = new Map(b.cands.map((c) => [c.uci, c.cp]));
  const shift = bCp.has(best.uci) ? best.cp - bCp.get(best.uci)! : 0;
  const deep = new Map<string, number>();
  const shallow = new Map<string, number>();
  const at = (rec: Map<number, number> | undefined) => {
    if (!rec) return undefined;
    let d = -1;
    for (const k of rec.keys()) if (k <= depth && k > d) d = k;
    return d >= Math.min(depth, 2) ? rec.get(d) : undefined;
  };
  for (const u of set) {
    if (aCp.has(u)) deep.set(u, aCp.get(u)!);
    else if (bCp.has(u)) deep.set(u, bCp.get(u)! + shift);
    const sh = at(b.byDepth.get(u)) ?? at(a.byDepth.get(u));
    if (sh !== undefined) shallow.set(u, sh);
  }
  return { deep, shallow };
}
