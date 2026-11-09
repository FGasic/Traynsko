/**
 * Maia-3: a network trained on Lichess games that predicts the move a person of a given rating would play.
 * Trayner uses it to choose like a human; Stockfish only keeps it from errors beyond its level (see human.ts).
 *
 * The encoding follows the reference code (CSSLab/maia3, maia3/dataset.py and utils.py):
 * - each position is a 64×12 one-hot board, mirrored (ranks flipped, colours swapped) when Black is to move;
 * - the input holds the last 8 positions, oldest first, left-padded with the earliest one: [64, 96];
 * - the output scores 4352 moves: from·64+to (python-chess squares, a1 = 0), then 256 promotions from rank 7
 *   to rank 8 (from file, to file, piece q r b n), always from the mirrored, White-to-move point of view.
 * The network runs in its own worker (src/maia-worker.ts) with ONNX Runtime; nothing leaves the device.
 */
import { Chess } from 'chess.js';

export const HISTORY = 8;
export const MOVE_SLOTS = 4352;
const PIECES = 'pnbrqk';

const sq = (name: string) => (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
const flipRank = (name: string) => name[0] + String(9 - Number(name[1]));

/** Index of a move (in the side-to-move's own coordinates) in the network's output. */
export function moveIndex(uci: string, blackToMove: boolean): number {
  let from = uci.slice(0, 2), to = uci.slice(2, 4);
  if (blackToMove) { from = flipRank(from); to = flipRank(to); }
  const promo = uci[4];
  if (promo) return 4096 + ((from.charCodeAt(0) - 97) * 8 + (to.charCodeAt(0) - 97)) * 4 + 'qrbn'.indexOf(promo);
  return sq(from) * 64 + sq(to);
}

/** One position as 64×12, mirrored when Black is to move (as python-chess `board.mirror()`). */
export function boardPlanes(fen: string): Float32Array {
  const [placement, turn] = fen.split(' ');
  const black = turn === 'b';
  const out = new Float32Array(64 * 12);
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    const rank = 7 - r;                       // FEN starts at rank 8
    let file = 0;
    for (const ch of rows[r] ?? '') {
      if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
      const white = ch === ch.toUpperCase();
      const type = PIECES.indexOf(ch.toLowerCase());
      if (type < 0 || file > 7) { file++; continue; }
      // mirrored: rank flips and colours swap, so the side to move is always "white"
      const square = (black ? 7 - rank : rank) * 8 + file;
      const colour = black ? (white ? 6 : 0) : (white ? 0 : 6);
      out[square * 12 + colour + type] = 1;
      file++;
    }
  }
  return out;
}

/** The network input for a game: the last 8 positions (current one last), oldest first, padded with the earliest. */
export function historyTokens(fens: string[]): Float32Array {
  if (!fens.length) throw new Error('no position');
  const recent = fens.slice(-HISTORY).map(boardPlanes);
  const slots = [...Array(HISTORY - recent.length).fill(recent[0]), ...recent] as Float32Array[];
  const out = new Float32Array(64 * HISTORY * 12);
  for (let s = 0; s < 64; s++) {
    for (let h = 0; h < HISTORY; h++) out.set(slots[h].subarray(s * 12, s * 12 + 12), s * HISTORY * 12 + h * 12);
  }
  return out;
}

export interface PolicyMove { uci: string; p: number }
export interface MaiaPolicy {
  /** legal moves, most likely first; probabilities add up to 1 */
  moves: PolicyMove[];
  /** how the side to move is expected to score, from its point of view: [loss, draw, win] */
  wdl: [number, number, number];
}

/** Legal moves of the current position with their probabilities, from the raw network output. */
export function policyFrom(fen: string, logits: Float32Array, value: Float32Array): MaiaPolicy {
  const chess = new Chess(fen);
  const black = chess.turn() === 'b';
  const legal = chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
  const scores = legal.map((u) => logits[moveIndex(u, black)]);
  const max = Math.max(...scores);
  const exps = scores.map((x) => Math.exp(x - max));
  const total = exps.reduce((a, b) => a + b, 0);
  const moves = legal.map((uci, i) => ({ uci, p: exps[i] / total })).sort((a, b) => b.p - a.p);
  const v = Array.from(value.slice(0, 3));
  const vm = Math.max(...v);
  const ve = v.map((x) => Math.exp(x - vm));
  const vt = ve.reduce((a, b) => a + b, 0);
  return { moves, wdl: [ve[0] / vt, ve[1] / vt, ve[2] / vt] };
}

/**
 * The bot's strength (as on the slider, a FIDE-like scale) on Maia's scale (Lichess blitz, 600–2600).
 * Lichess ratings run higher than FIDE, more so lower down; past 2600 the model is used near its edge and
 * Stockfish takes over gradually (human.ts).
 */
export function maiaElo(elo: number): number {
  const lichess = elo + 300 - Math.max(0, elo - 1800) * 0.18;
  return Math.round(Math.min(2700, Math.max(600, lichess)));
}

/* ---------------- the worker ---------------- */

declare const __MAIA_WORKER__: string;
declare const __MAIA_MODEL__: string;

export type MaiaState = 'idle' | 'loading' | 'ready' | 'failed';

/** The network in a worker: loaded once, on demand; any failure leaves Trayner on Stockfish alone. */
export class Maia {
  state: MaiaState = 'idle';
  /** load time and the latest inference time, for checks */
  stats = { loadMs: 0, runMs: 0 };
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve(v: { logits: Float32Array; value: Float32Array }): void; reject(e: Error): void }>();

  constructor(private workerUrl = typeof __MAIA_WORKER__ === 'string' ? __MAIA_WORKER__ : '', private modelUrl = typeof __MAIA_MODEL__ === 'string' ? __MAIA_MODEL__ : '') {}

  /** Start loading (idempotent). Resolves when ready, rejects if this device can't run it. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.state = 'loading';
    const t0 = performance.now();
    this.loading = new Promise<void>((resolve, reject) => {
      let w: Worker;
      try { w = new Worker(this.workerUrl); } catch (e) { reject(e); return; }
      this.worker = w;
      const timer = setTimeout(() => reject(new Error('maia timeout')), 120_000);
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d?.type === 'ready') { clearTimeout(timer); this.stats.loadMs = Math.round(performance.now() - t0); resolve(); }
        else if (d?.type === 'error' && d.id === undefined) { clearTimeout(timer); reject(new Error(d.message)); }
        else if (d?.type === 'result' || d?.type === 'error') {
          const p = this.pending.get(d.id);
          if (!p) return;
          this.pending.delete(d.id);
          if (d.type === 'result') p.resolve({ logits: d.logits, value: d.value });
          else p.reject(new Error(d.message));
        }
      };
      w.onerror = (ev) => { ev.preventDefault?.(); clearTimeout(timer); reject(new Error('maia worker error')); };
      w.postMessage({ type: 'load', model: this.modelUrl });
    });
    this.loading.then(() => { this.state = 'ready'; }, () => {
      this.state = 'failed';
      this.worker?.terminate();
      this.worker = null;
      this.pending.forEach((p) => p.reject(new Error('maia unavailable')));
      this.pending.clear();
    });
    return this.loading;
  }

  /**
   * What a player of `elo` (Maia's scale) would play here. `fens`: the game so far, current position last.
   * Rejects when the network isn't ready within `waitMs`.
   */
  async policy(fens: string[], elo: number, oppoElo = elo, waitMs = 0): Promise<MaiaPolicy> {
    if (this.state !== 'ready') {
      if (this.state === 'failed') throw new Error('maia unavailable');
      const load = this.load();
      await Promise.race([load, new Promise((_, rej) => setTimeout(() => rej(new Error('maia not ready')), waitMs))]);
    }
    const tokens = historyTokens(fens);
    const id = ++this.seq;
    const t0 = performance.now();
    const out = await new Promise<{ logits: Float32Array; value: Float32Array }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('maia slow')); }, 8000);
      this.worker!.postMessage({ type: 'run', id, tokens, elo: Math.round(elo), oppo: Math.round(oppoElo) }, [tokens.buffer]);
    });
    this.stats.runMs = Math.round(performance.now() - t0);
    return policyFrom(fens[fens.length - 1], out.logits, out.value);
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
  }
}
