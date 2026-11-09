/**
 * Trayner: chooses like a person of the chosen level, not like an engine with a margin.
 *
 * 1. Maia-3 says which moves a player of that level would consider, and how likely each one is.
 * 2. Stockfish scores those moves twice: as seen at a shallow depth (what that player can see over the board)
 *    and as seen deep (the truth).
 * 3. Visible errors beyond the level (hanging a piece, missing a mate in two) are ruled out. What the player
 *    can't see barely changes the choice at lower levels (a deep tactic is missed, or fallen into, as often as
 *    people of that level do), and weighs more as the level rises.
 * 4. Above ~2350 the engine's opinion weighs more and more, so 2800 plays close to the best move.
 *
 * Everything here is pure; the session feeds it the network's policy and the engine's scores.
 */
import type { PolicyMove } from './maia';

export interface HumanParams {
  /** plies a player of this level reliably sees */
  depthSeen: number;
  /** largest visible loss (centipawns) a move may have */
  visibleCap: number;
  /** how quickly a visible loss makes a move unlikely */
  temp: number;
  /** the same for losses the player can't see (large: they hardly matter) */
  hiddenTemp: number;
  /** 1: follow the network; 0.2: the network barely matters (very high levels) */
  policyExp: number;
  /** mates in up to this many moves are always found */
  mateSight: number;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function humanParams(elo: number): HumanParams {
  const x = clamp((elo - 1800) / 1000, 0, 1);        // 0 at 1800, 1 at 2800
  const s = clamp((elo - 2350) / 450, 0, 1);         // engine weight above Maia's range
  const temp = 140 - 110 * x;
  return {
    depthSeen: Math.round(4 + 6 * x),
    visibleCap: 220 - 150 * x,
    temp,
    hiddenTemp: 60 + 900 * Math.pow(1 - x, 1.3),
    policyExp: 1 - 0.8 * s,
    mateSight: 2 + Math.round(4 * x),
  };
}

/** The moves worth checking: the likeliest ones until 95 % of the probability (at most 8). */
export function consideredMoves(policy: PolicyMove[], max = 8): string[] {
  const out: string[] = [];
  let acc = 0;
  for (const m of policy) {
    if (out.length >= max || (acc >= 0.95 && out.length > 0) || (m.p < 0.004 && out.length > 0)) break;
    out.push(m.uci);
    acc += m.p;
  }
  return out;
}

const MATE = 50_000;
/** Losses beyond this (a lost piece and more, or a mate) all count the same when weighing moves. */
const LOSS_CAP = 1000;
/** Plies to mate from a mapped score (see parseInfo: ±(100000 - moves·100)). */
const mateMoves = (cp: number) => Math.round((100_000 - Math.abs(cp)) / 100);

export interface HumanInput {
  policy: PolicyMove[];
  /** the best move of an unrestricted search, and its score */
  best: { uci: string; cp: number };
  /** deep score of each considered move (and the best one), same scale as `best.cp` */
  deep: Map<string, number>;
  /** shallow score (at `depthSeen`) of the same moves, when known */
  shallow: Map<string, number>;
  elo: number;
}

export interface HumanChoice {
  uci: string;
  why: 'mate' | 'human' | 'fallback';
  /** each considered move: probability from the network, losses, final weight */
  table: { uci: string; p: number; seen: number; hidden: number; w: number }[];
}

/** Pick a move. `rnd` in [0, 1). */
export function chooseHuman(inp: HumanInput, rnd: () => number = Math.random): HumanChoice {
  const pr = humanParams(inp.elo);
  const prob = new Map(inp.policy.map((m) => [m.uci, m.p]));
  // a short forced mate is always found
  if (inp.best.cp > MATE && mateMoves(inp.best.cp) <= pr.mateSight) return { uci: inp.best.uci, why: 'mate', table: [] };

  const moves = [...new Set([...consideredMoves(inp.policy), inp.best.uci])].filter((u) => inp.deep.has(u));
  if (!moves.length) return { uci: inp.best.uci, why: 'fallback', table: [] };
  const deepBest = Math.max(...moves.map((u) => inp.deep.get(u)!));
  const shallowKnown = moves.filter((u) => inp.shallow.has(u));
  const shallowBest = shallowKnown.length ? Math.max(...shallowKnown.map((u) => inp.shallow.get(u)!)) : null;

  const table = moves.map((uci) => {
    const deepLoss = Math.max(0, deepBest - inp.deep.get(uci)!);
    // what the player can see: the shallow loss (when known), never more than the real one
    const seen = shallowBest !== null && inp.shallow.has(uci) ? clamp(shallowBest - inp.shallow.get(uci)!, 0, deepLoss) : deepLoss;
    const hidden = deepLoss - seen;
    const p = prob.get(uci) ?? 0;
    let w = 0;
    const intoMate = inp.deep.get(uci)! < -MATE && !(deepBest < -MATE);
    if (seen <= pr.visibleCap && !(intoMate && mateMoves(inp.deep.get(uci)!) <= pr.mateSight)) {
      w = Math.pow(p + 0.002, pr.policyExp) * Math.exp(-seen / pr.temp) * Math.exp(-Math.min(hidden, LOSS_CAP) / pr.hiddenTemp);
    }
    return { uci, p, seen, hidden, w };
  });

  const total = table.reduce((a, t) => a + t.w, 0);
  if (total <= 0) {
    // every option is a visible error at this level: the least bad as seen, then as it really is
    const pick = [...table].sort((a, b) => a.seen - b.seen || a.seen + a.hidden - (b.seen + b.hidden))[0];
    return { uci: pick.uci, why: 'fallback', table };
  }
  let r = rnd() * total;
  for (const t of table) {
    r -= t.w;
    if (r <= 0 && t.w > 0) return { uci: t.uci, why: 'human', table };
  }
  return { uci: table.filter((t) => t.w > 0).slice(-1)[0].uci, why: 'human', table };
}

/** Gaussian with mean 0 and deviation 1 (Box–Muller). */
function gauss(rnd: () => number) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * How long a person would think: little for an obvious move (a recapture, the only good move), longer when
 * several moves are plausible, a little more on leaving the prepared line; faster when short of time.
 * `avgMs` is the bot's time per move from the settings.
 */
export function thinkTime(o: { top: number; legal: number; avgMs: number; clockMs: number; freePlies: number }, rnd: () => number = Math.random): number {
  const f = o.top >= 0.9 ? 0.3 : o.top >= 0.75 ? 0.5 : o.top >= 0.5 ? 0.85 : o.top >= 0.3 ? 1.2 : 1.6;
  let t = o.avgMs * f * (o.freePlies <= 1 ? 1.3 : 1) * Math.exp(0.3 * gauss(rnd));
  t = clamp(t, 450, o.avgMs * 3);
  if (o.legal <= 1) t = Math.min(t, 500);
  if (o.clockMs < 60_000) t = Math.min(t, o.clockMs / 25);
  if (o.clockMs < 20_000) t = Math.min(t, 900);
  return Math.max(250, t);
}
