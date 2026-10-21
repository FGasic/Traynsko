import { Chess, type Move, type Square } from 'chess.js';
import { ChessClock, type Side } from './clock';
import { chooseMove, type Bot } from './bots';
import type { Engine } from './engine';
import { START_FEN, type Line } from './pgn';
import { botAcceptsDraw, botOffersDraw, EQUAL_CP } from './draws';

export type Phase = 'line' | 'bot' | 'over';
export type Outcome = 'win' | 'loss' | 'draw';
export type DrawOffer = 'none' | 'user' | 'bot';
export type MoveBy = 'user' | 'book' | 'bot' | 'pre';

export interface SessionConfig {
  line: Line;
  userColor: Side;
  bot: Bot;
  elo: number;
  baseMs: number;
  incMs: number;
  botMoveMs: number;
  /** Full move number where the user starts playing (1 = from the first move). */
  startMove: number;
}

export interface SessionEvents {
  change(): void;
  move(m: Move, by: MoveBy): void;
  wrong(attempted: string): void;
  phase(): void;
  end(): void;
  engineError(): void;
  /** The bot turned down the player's offer, or proposed a draw itself. */
  draw(kind: 'declined' | 'offered'): void;
}

export interface PlayedMove { san: string; uci: string; by: MoveBy; clock: number }

/** How many plies of the line are pre-played so the user starts at `startMove`. */
export function plySkip(lineUci: string[], startFen: string, userColor: Side, startMove: number): number {
  if (startMove <= 1) return 0;
  const firstTurn = startFen.split(' ')[1] as Side;
  const firstNo = Number(startFen.split(' ')[5]) || 1;
  // ply index -> side to move
  const sideAt = (i: number): Side => ((i % 2 === 0) === (firstTurn === 'w') ? 'w' : 'b');
  const userPlies = lineUci.map((_, i) => i).filter((i) => sideAt(i) === userColor);
  if (userPlies.length === 0) return lineUci.length;
  // move number of ply i
  const moveNoAt = (i: number) => firstNo + Math.floor((i + (firstTurn === 'b' ? 1 : 0)) / 2);
  const target = userPlies.find((i) => moveNoAt(i) >= startMove);
  return target ?? userPlies[userPlies.length - 1];
}

function insufficient(chess: Chess, side: Side): boolean {
  const pieces = chess.board().flat().filter((p) => p && p.color === side && p.type !== 'k');
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (pieces[0]!.type === 'n' || pieces[0]!.type === 'b')) return true;
  return false;
}

export class Session {
  chess: Chess;
  startFen: string;
  lineMoves: string[];
  lineIdx = 0;
  preplied = 0;
  phase: Phase = 'line';
  played: PlayedMove[] = [];
  mistakes = 0;
  attempts = 0;
  hints = 0;
  thinking = false;
  drawOffer: DrawOffer = 'none';
  private equalStreak = 0;
  private lastBotOffer = -1000;
  private lastDeclined = -1000;
  /** The bot's latest evaluation, from its own side (centipawns). */
  private lastEval: number | null = null;
  clock: ChessClock;
  result?: '1-0' | '0-1' | '1/2-1/2';
  termination?: string;
  outcome?: Outcome;
  private destroyed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(public cfg: SessionConfig, private engine: Engine | null, private ev: SessionEvents) {
    this.startFen = cfg.line.fen ?? START_FEN;
    this.chess = new Chess(this.startFen);
    this.lineMoves = cfg.line.uci.split(' ').filter(Boolean);
    this.clock = new ChessClock(cfg.baseMs, cfg.incMs);
    const skip = plySkip(this.lineMoves, this.startFen, cfg.userColor, cfg.startMove);
    for (let i = 0; i < skip; i++) {
      const m = this.chess.move(this.uciObj(this.lineMoves[i]));
      this.played.push({ san: m.san, uci: this.lineMoves[i], by: 'pre', clock: cfg.baseMs });
    }
    this.lineIdx = skip;
    this.preplied = skip;
  }

  /** Kick off: play the opponent's line move if it's their turn, or go straight to the game. */
  start() {
    this.engine?.newGame();
    if (this.lineIdx >= this.lineMoves.length) this.enterBotPhase();
    else if (this.chess.turn() !== this.cfg.userColor) this.later(() => this.playBook(), 600);
    this.ev.change();
  }

  get userTurn() { return this.phase !== 'over' && this.chess.turn() === this.cfg.userColor && !this.thinking; }
  get expected(): string | undefined { return this.phase === 'line' ? this.lineMoves[this.lineIdx] : undefined; }
  get linePlies() { return Math.min(this.lineIdx, this.lineMoves.length); }

  private uciObj(uci: string) {
    return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] };
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.destroyed) fn(); }, ms);
    this.timers.add(t);
  }

  private apply(uci: string, by: MoveBy): Move {
    const mover = this.chess.turn();
    const m = this.chess.move(this.uciObj(uci));
    this.clock.pressAfterMove(mover);
    this.played.push({ san: m.san, uci, by, clock: this.clock.remaining[mover] });
    this.ev.move(m, by);
    return m;
  }

  /** User move. Returns 'ok', or 'wrong' when it doesn't match the repertoire line. */
  userMove(uci: string): 'ok' | 'wrong' | 'illegal' {
    if (!this.userTurn) return 'illegal';
    if (this.phase === 'line') {
      const exp = this.expected!;
      if (uci !== exp) {
        // illegal moves never reach here (board only offers legal ones)
        this.mistakes++;
        this.attempts++;
        this.ev.wrong(uci);
        this.ev.change();
        return 'wrong';
      }
      this.attempts = 0;
      this.apply(uci, 'user');
      this.lineIdx++;
      if (this.checkEnd()) return 'ok';
      if (this.lineIdx >= this.lineMoves.length) this.enterBotPhase();
      else this.later(() => this.playBook(), 320);
      this.ev.change();
      return 'ok';
    }
    // bot phase: moving on means declining the bot's offer
    try { this.apply(uci, 'user'); } catch { return 'illegal'; }
    if (this.drawOffer === 'bot') this.drawOffer = 'none';
    if (this.checkEnd()) return 'ok';
    this.botThink();
    this.ev.change();
    return 'ok';
  }

  /** Reveal the expected move (counts as used help). */
  hint(): string | undefined {
    if (this.phase !== 'line') return undefined;
    this.hints++;
    this.ev.change();
    return this.expected;
  }

  private playBook() {
    if (this.phase !== 'line' || this.chess.turn() === this.cfg.userColor) return;
    this.apply(this.lineMoves[this.lineIdx], 'book');
    this.lineIdx++;
    if (this.checkEnd()) return;
    if (this.lineIdx >= this.lineMoves.length) this.enterBotPhase();
    this.ev.change();
  }

  private enterBotPhase() {
    if (this.phase !== 'line') return;
    this.phase = 'bot';
    this.ev.phase();
    if (this.chess.turn() !== this.cfg.userColor) this.botThink();
    this.ev.change();
  }

  private async botThink() {
    if (this.phase !== 'bot' || !this.engine) { if (!this.engine) this.ev.engineError(); return; }
    this.thinking = true;
    this.ev.change();
    const botSide = this.chess.turn();
    const t0 = performance.now();
    let budget = this.cfg.botMoveMs * (0.8 + Math.random() * 0.4);
    const left = this.clock.left(botSide);
    if (left < 60_000) budget = Math.min(budget, left / 25);
    budget = Math.max(300, budget);
    const fen = this.chess.fen();
    let uci: string;
    let botEval = 0;
    try {
      const cands = await this.engine.search(fen, budget * 0.85);
      if (this.destroyed || this.phase !== 'bot' || this.chess.fen() !== fen) { this.thinking = false; return; }
      uci = chooseMove(fen, cands, this.cfg.bot, this.cfg.elo);
      botEval = Math.max(...cands.map((c) => c.cp));
    } catch {
      this.thinking = false;
      this.ev.engineError();
      this.ev.change();
      return;
    }
    const wait = budget - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => this.later(() => r(null), wait));
    if (this.destroyed || this.phase !== 'bot' || this.chess.fen() !== fen) { this.thinking = false; return; }
    // Draws: answer the player's offer, or propose one with this move.
    const freePlies = this.played.length - this.lineMoves.length;
    const ctx = { fen, botEval, freePlies };
    if (this.drawOffer === 'user') {
      if (botAcceptsDraw(ctx)) { this.finish('1/2-1/2', 'Tablas por acuerdo'); return; }
      this.drawOffer = 'none';
      this.lastDeclined = this.played.length;
      this.ev.draw('declined');
    }
    this.lastEval = botEval;
    this.equalStreak = Math.abs(botEval) <= EQUAL_CP ? this.equalStreak + 1 : 0;
    const ply = this.played.length;
    this.thinking = false;
    this.apply(uci, 'bot');
    if (this.checkEnd()) { this.ev.change(); return; }
    if (this.drawOffer === 'none' && botOffersDraw({ ...ctx, fen: this.chess.fen(), equalStreak: this.equalStreak, pliesSinceOffer: ply - this.lastBotOffer })) {
      this.drawOffer = 'bot';
      this.lastBotOffer = ply;
      this.ev.draw('offered');
    }
    this.ev.change();
  }

  /** A new offer is allowed once a few moves have passed since the last refusal. */
  get canOfferDraw() {
    return this.phase === 'bot' && this.drawOffer === 'none' && this.played.length - this.lastDeclined >= 6;
  }

  /**
   * The player proposes a draw. On the player's turn the bot answers at once from its latest
   * evaluation; otherwise (or before it has evaluated anything) it answers with its next move.
   */
  offerDraw() {
    if (!this.canOfferDraw) return;
    if (this.chess.turn() === this.cfg.userColor && !this.thinking && this.lastEval !== null) {
      const ctx = { fen: this.chess.fen(), botEval: this.lastEval, freePlies: this.played.length - this.lineMoves.length };
      if (botAcceptsDraw(ctx)) { this.finish('1/2-1/2', 'Tablas por acuerdo'); return; }
      this.lastDeclined = this.played.length;
      this.ev.draw('declined');
      this.ev.change();
      return;
    }
    this.drawOffer = 'user';
    this.ev.change();
  }

  /** Accept the bot's offer. */
  acceptDraw() {
    if (this.phase !== 'bot' || this.drawOffer !== 'bot') return;
    this.finish('1/2-1/2', 'Tablas por acuerdo');
  }

  declineDraw() {
    if (this.drawOffer !== 'bot') return;
    this.drawOffer = 'none';
    this.ev.change();
  }

  private finish(result: '1-0' | '0-1' | '1/2-1/2', termination: string) {
    if (this.phase === 'over') return;
    this.clock.stop();
    this.phase = 'over';
    this.thinking = false;
    this.drawOffer = 'none';
    this.result = result;
    this.termination = termination;
    const userWins = (result === '1-0' && this.cfg.userColor === 'w') || (result === '0-1' && this.cfg.userColor === 'b');
    this.outcome = result === '1/2-1/2' ? 'draw' : userWins ? 'win' : 'loss';
    this.engine?.stop();
    this.ev.end();
    this.ev.change();
  }

  private checkEnd(): boolean {
    const c = this.chess;
    if (c.isCheckmate()) { this.finish(c.turn() === 'w' ? '0-1' : '1-0', 'Jaque mate'); return true; }
    if (c.isStalemate()) { this.finish('1/2-1/2', 'Ahogado'); return true; }
    if (c.isInsufficientMaterial()) { this.finish('1/2-1/2', 'Material insuficiente'); return true; }
    if (c.isThreefoldRepetition()) { this.finish('1/2-1/2', 'Triple repetición'); return true; }
    if (c.isDrawByFiftyMoves()) { this.finish('1/2-1/2', 'Regla de las 50 jugadas'); return true; }
    return false;
  }

  /** Call periodically: ends the game on time. */
  tick() {
    if (this.phase === 'over') return;
    const flagged = this.clock.flagged();
    if (!flagged) return;
    const other: Side = flagged === 'w' ? 'b' : 'w';
    if (insufficient(this.chess, other)) this.finish('1/2-1/2', 'Tiempo agotado sin material para ganar');
    else this.finish(flagged === 'w' ? '0-1' : '1-0', 'Tiempo agotado');
  }

  resign() {
    this.finish(this.cfg.userColor === 'w' ? '0-1' : '1-0', 'Abandono');
  }

  destroy() {
    this.destroyed = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.engine?.stop();
  }
}
