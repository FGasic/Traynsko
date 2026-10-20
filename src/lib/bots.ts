import { Chess, type Move } from 'chess.js';

export type BotStyle = 'solid' | 'aggressive' | 'positional' | 'simplifier' | 'fighter' | 'wild' | 'precise';

export interface Bot {
  id: string;
  name: string;
  style: BotStyle;
  styleLabel: string;
  blurb: string;
  hue: number;          // avatar colour
  glyph: 'tower' | 'bolt' | 'grid' | 'scale' | 'blade' | 'dice' | 'gear';
  tolMul: number;       // multiplies the move-loss tolerance
  tempMul: number;      // multiplies the sampling temperature
}

export const BOTS: Bot[] = [
  { id: 'muralla', name: 'Muralla', style: 'solid', styleLabel: 'Sólido', hue: 205, glyph: 'tower', tolMul: 0.8, tempMul: 0.8,
    blurb: 'Prioriza la seguridad del rey y las estructuras sanas. Rara vez se desordena.' },
  { id: 'tormenta', name: 'Tormenta', style: 'aggressive', styleLabel: 'Agresivo', hue: 12, glyph: 'bolt', tolMul: 1.1, tempMul: 1.1,
    blurb: 'Busca jaques, capturas y avances de peones contra tu rey.' },
  { id: 'arquitecto', name: 'Arquitecto', style: 'positional', styleLabel: 'Posicional', hue: 160, glyph: 'grid', tolMul: 1.0, tempMul: 0.9,
    blurb: 'Maniobra con piezas menores y torres; evita sacar la dama pronto.' },
  { id: 'notario', name: 'Notario', style: 'simplifier', styleLabel: 'Simplificador', hue: 45, glyph: 'scale', tolMul: 0.9, tempMul: 0.9,
    blurb: 'Cambia piezas siempre que puede y te lleva a finales.' },
  { id: 'gladiador', name: 'Gladiador', style: 'fighter', styleLabel: 'Combativo', hue: 340, glyph: 'blade', tolMul: 1.15, tempMul: 1.1,
    blurb: 'Evita los cambios y mantiene la tensión para jugar a ganar.' },
  { id: 'comodin', name: 'Comodín', style: 'wild', styleLabel: 'Impredecible', hue: 275, glyph: 'dice', tolMul: 1.5, tempMul: 1.7,
    blurb: 'Elige entre más alternativas razonables. La partida cambia mucho de una vez a otra.' },
  { id: 'maquina', name: 'Máquina', style: 'precise', styleLabel: 'Preciso', hue: 225, glyph: 'gear', tolMul: 0.4, tempMul: 0.4,
    blurb: 'Casi siempre juega la mejor jugada del motor. El más exigente.' },
];

export const botById = (id: string) => BOTS.find((b) => b.id === id) ?? BOTS[0];

/** A candidate from Stockfish MultiPV, score from the side to move, in centipawns. */
export interface Candidate {
  uci: string;
  cp: number;          // mate scores mapped to ±(100000 - plies*100)
  depth: number;
  mate?: number;
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function styleBonus(style: BotStyle, mv: Move, chess: Chess, evalCp: number): number {
  const isCapture = !!mv.captured;
  const isCheck = mv.san.includes('+') || mv.san.includes('#');
  const isCastle = mv.flags.includes('k') || mv.flags.includes('q');
  const evenTrade = isCapture && VALUE[mv.captured!] === VALUE[mv.piece] && mv.piece !== 'p';
  const toRank = Number(mv.to[1]);
  const fromRank = Number(mv.from[1]);
  const forward = mv.color === 'w' ? toRank - fromRank : fromRank - toRank;
  const inEnemyHalf = mv.color === 'w' ? toRank >= 5 : toRank <= 4;
  const moveNo = Number(chess.fen().split(' ')[5]);
  // enemy king file (for pawn storms)
  const board = chess.board();
  let enemyKingFile = 4;
  board.forEach((row) => row.forEach((sq) => { if (sq && sq.type === 'k' && sq.color !== mv.color) enemyKingFile = sq.square.charCodeAt(0) - 97; }));
  const fileIdx = mv.from.charCodeAt(0) - 97;

  switch (style) {
    case 'aggressive': {
      let b = 0;
      if (isCheck) b += 10;
      if (isCapture) b += 5;
      if (inEnemyHalf && mv.piece !== 'p' && mv.piece !== 'k') b += 4;
      if (mv.piece === 'p' && forward > 0 && Math.abs(fileIdx - enemyKingFile) <= 1 && moveNo > 8) b += 6;
      return b;
    }
    case 'solid': {
      let b = 0;
      if (isCastle) b += 12;
      if (mv.piece === 'k' && !isCastle && moveNo < 30) b -= 6;
      // own king shelter pawns
      let ownKingFile = 4;
      board.forEach((row) => row.forEach((sq) => { if (sq && sq.type === 'k' && sq.color === mv.color) ownKingFile = sq.square.charCodeAt(0) - 97; }));
      if (mv.piece === 'p' && Math.abs(fileIdx - ownKingFile) <= 1 && moveNo < 35) b -= 7;
      if (forward < 0 && mv.piece !== 'k') b += 2;
      return b;
    }
    case 'positional': {
      let b = 0;
      if (!isCapture && !isCheck && (mv.piece === 'n' || mv.piece === 'b' || mv.piece === 'r')) b += 4;
      if (mv.piece === 'q' && moveNo < 20) b -= 6;
      if (mv.piece === 'p' && 'cdef'.includes(mv.from[0]) && forward > 0) b += 2;
      return b;
    }
    case 'simplifier':
      return evenTrade && evalCp > -80 ? 12 : isCapture ? 3 : 0;
    case 'fighter': {
      let b = 0;
      if (evenTrade) b -= 9;
      if (mv.piece === 'p' && forward > 0) b += 3;
      if (isCheck) b += 3;
      return b;
    }
    default:
      return 0;
  }
}

/** Strength → tolerance (max centipawn loss allowed) and temperature. 2300 ≈ 65cp / 26cp. */
export function strengthParams(elo: number) {
  const gap = Math.max(0, 2800 - elo);
  return { tolerance: 15 + gap * 0.1, temperature: 6 + gap * 0.04 };
}

/**
 * Pick a move among engine candidates. Varies between near-equal moves,
 * never drops more than the tolerance, and converts decisive positions.
 */
export function chooseMove(
  fen: string,
  candidates: Candidate[],
  bot: Bot,
  elo: number,
  rnd: () => number = Math.random,
): string {
  const cands = [...candidates].sort((a, b) => b.cp - a.cp);
  if (cands.length === 0) throw new Error('no candidates');
  const best = cands[0];
  if (cands.length === 1) return best.uci;
  // Forced mate for us: humans at this level find short mates.
  if (best.mate !== undefined && best.mate > 0 && best.mate <= 6) return best.uci;

  const { tolerance, temperature } = strengthParams(elo);
  let tol = tolerance * bot.tolMul;
  const temp = Math.max(2, temperature * bot.tempMul);
  // Clearly winning: play cleaner (don't throw advantages away).
  if (best.cp > 350) tol = Math.min(tol, 35);
  // Never pick a move that walks into a forced mate when the best one doesn't.
  const chess = new Chess(fen);
  const scored = cands
    .filter((c) => !(c.mate !== undefined && c.mate < 0 && !(best.mate !== undefined && best.mate < 0)))
    .map((c) => {
      const loss = best.cp - c.cp;
      let bonus = 0;
      try {
        const mv = chess.move({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci[4] });
        bonus = styleBonus(bot.style, mv, chess, best.cp);
        chess.undo();
      } catch { /* illegal candidate: ignore bonus */ }
      if (bot.style === 'wild') bonus += (rnd() - 0.5) * 16;
      return { c, loss, bonus };
    })
    .filter((s) => s.c === best || s.loss <= tol);

  const weights = scored.map((s) => Math.exp(-(Math.max(0, s.loss - s.bonus)) / temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i].c.uci;
  }
  return scored[scored.length - 1].c.uci;
}

/** Parse one UCI "info" line into a MultiPV candidate. */
export function parseInfo(line: string): (Candidate & { multipv: number }) | null {
  if (!line.startsWith('info') || !line.includes(' pv ') || line.includes('upperbound') || line.includes('lowerbound')) return null;
  const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
  const multipv = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 1);
  const cpM = / score cp (-?\d+)/.exec(line);
  const mateM = / score mate (-?\d+)/.exec(line);
  const pv = / pv (\S+)/.exec(line)?.[1];
  if (!pv) return null;
  if (mateM) {
    const m = Number(mateM[1]);
    const cp = m > 0 ? 100000 - m * 100 : m < 0 ? -100000 - m * 100 : -100000;
    return { uci: pv, cp, depth, multipv, mate: m };
  }
  if (cpM) return { uci: pv, cp: Number(cpM[1]), depth, multipv };
  return null;
}
