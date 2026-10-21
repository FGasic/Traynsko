// When the bot agrees to a draw, and when it offers one.
// Goal: no time lost shuffling in dead-equal positions, without handing out draws in live middlegames.

const VALUE: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 };

export interface DrawContext {
  fen: string;
  botEval: number;     // centipawns from the bot's point of view (positive = bot better)
  freePlies: number;   // plies played since the repertoire line ended
}

/** Piece material per side (pawns and kings excluded) and the half-move clock. */
export function position(fen: string) {
  const [board, , , , half] = fen.split(' ');
  const mat = { w: 0, b: 0 };
  let queens = 0;
  for (const ch of board) {
    const v = VALUE[ch.toLowerCase()];
    if (!v) continue;
    if (ch.toLowerCase() === 'q') queens++;
    if (ch === ch.toUpperCase()) mat.w += v; else mat.b += v;
  }
  const halfmove = Number(half) || 0;
  return {
    /** Endgame without queens and at most rook + minor piece each, e.g. any rook ending. */
    simplified: queens === 0 && mat.w <= 8 && mat.b <= 8,
    /** Ten moves or more without a capture or a pawn move. */
    quiet: halfmove >= 20,
  };
}

/** The player offered a draw: the bot answers with its next move. */
export function botAcceptsDraw({ fen, botEval, freePlies }: DrawContext): boolean {
  const p = position(fen);
  if (p.simplified || p.quiet) return botEval <= 80;
  // Early in a game with pieces on the board, it plays on unless it is worse.
  if (freePlies < 30) return botEval <= -50;
  return botEval <= 25;
}

/**
 * The bot proposes a draw when the position has been dead equal for several of its moves
 * and nothing is happening on the board.
 */
export function botOffersDraw(ctx: DrawContext & { equalStreak: number; pliesSinceOffer: number }): boolean {
  if (ctx.equalStreak < 4 || ctx.pliesSinceOffer < 20 || Math.abs(ctx.botEval) > 30) return false;
  const p = position(ctx.fen);
  return p.simplified || p.quiet || ctx.freePlies >= 80;
}

/** Evaluations within this margin count as "dead equal" for the streak. */
export const EQUAL_CP = 30;
