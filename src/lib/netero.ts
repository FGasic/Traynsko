/**
 * Modo Netero: the session engine, with no UI. The screen drives it (moves, the rival's replies, pauses) and
 * reads its state; a clock function can be injected so the timing is testable.
 *
 * - Lines are played from the first move. A wrong move adds a fail and is taken back; the player tries again.
 * - A line with any fail must then be repeated from the start until a pass comes out clean.
 * - Score: each node (position where the player moves + expected move) counts once, at its first appearance.
 *   Its time runs from the moment the position is ready (after the rival's animation) to the right move,
 *   leaving out animations, the wrong-move glow and pauses.
 */
import { Chess, type Move, type Square } from 'chess.js';
import type { Line, Repertoire } from '../../shared/types';
import { lineKey } from '../../shared/picks';
import { neteroScore, scopeFingerprint, scopeLines, type NeteroDevice, type NeteroMode, type NeteroScope, type NeteroSummary, type Score } from '../../shared/netero';
import { START_FEN } from './pgn';

/** Chessground's move animation (Board.tsx): the position is not ready to read before it ends. */
export const ANIM_MS = 180;
/** The red glow after a wrong move, before the board is restored (same as the normal training). */
export const WRONG_MS = 260;
/** Wrong tries at one node before the move can be shown. */
export const HINT_AFTER = 3;

export interface PlanLine { key: string; rep: Repertoire; line: Line }

export interface Plan {
  mode: NeteroMode;
  scope: NeteroScope | null;
  /** fingerprint of every line of the scope (active or not) */
  fp: string | null;
  /** every line of the scope is active: the session may set a record */
  eligible: boolean;
  lines: PlanLine[];
  /** lines of the scope, and how many of them are in training */
  inScope: number;
  activeInScope: number;
}

export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sideAt = (fen: string, ply: number): 'w' | 'b' => {
  const first = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return ply % 2 === 0 ? first : first === 'w' ? 'b' : 'w';
};

/** How many moves the player makes in a line, playing the repertoire's colour. */
export function userPlies(line: Line, color: 'w' | 'b'): number {
  const fen = line.fen ?? START_FEN;
  return line.uci.split(' ').filter(Boolean).filter((_, i) => sideAt(fen, i) === color).length;
}

const scopeItems = (reps: Repertoire[], scope: { kind: 'world' | 'rep'; id: string } | null): PlanLine[] => scopeLines(reps, scope);

const playable = (x: PlanLine) => userPlies(x.line, x.rep.color) > 0;

/** Netero completo: every active line of the scope, in a new random order. */
export function planFull(reps: Repertoire[], off: Set<string>, scope: NeteroScope, rng: Rng = Math.random): Plan {
  const all = scopeItems(reps, scope);
  const active = all.filter((x) => !off.has(x.key));
  return {
    mode: 'full', scope,
    fp: all.length ? scopeFingerprint(all.map((x) => ({ color: x.rep.color, line: x.line }))) : null,
    eligible: all.length > 0 && active.length === all.length,
    lines: shuffle(active.filter(playable), rng),
    inScope: all.length, activeInScope: active.length,
  };
}

/** `n` active lines, those in the review queue first, the rest at random (the Campaign's memory phase). */
export function planDaily(reps: Repertoire[], off: Set<string>, n: number, queue: string[], rng: Rng = Math.random, mode: NeteroMode = 'daily'): Plan {
  const active = scopeItems(reps, null).filter((x) => !off.has(x.key) && playable(x));
  const byKey = new Map(active.map((x) => [x.key, x]));
  const picked: PlanLine[] = [];
  for (const k of queue) {
    if (picked.length >= n) break;
    const x = byKey.get(k);
    if (x && !picked.includes(x)) picked.push(x);
  }
  for (const x of shuffle(active.filter((y) => !picked.includes(y)), rng)) {
    if (picked.length >= n) break;
    picked.push(x);
  }
  return { mode, scope: null, fp: null, eligible: false, lines: shuffle(picked, rng), inScope: active.length, activeInScope: active.length };
}

/** The Campaign's memory phase: 3 lines (the review queue first). */
export const planCampaign = (reps: Repertoire[], off: Set<string>, queue: string[], n = 3, rng: Rng = Math.random) => planDaily(reps, off, n, queue, rng, 'campaign');

/** The same lines again, from their keys (a memory phase restarted after its session was lost). */
export function planFromKeys(reps: Repertoire[], keys: string[], mode: NeteroMode, rng: Rng = Math.random): Plan {
  const p = planErrors(reps, keys, rng);
  return { ...p, mode };
}

/** Repetir errores: the lines given (those with fails in the session just finished). */
export function planErrors(reps: Repertoire[], keys: string[], rng: Rng = Math.random): Plan {
  const want = new Set(keys);
  const lines = scopeItems(reps, null).filter((x) => want.has(x.key) && playable(x));
  return { mode: 'errors', scope: null, fp: null, eligible: false, lines: shuffle(lines, rng), inScope: lines.length, activeInScope: lines.length };
}

export const lineTitle = (l: Line) => (l.white.trim() && l.white.trim() !== '?' ? l.white.trim() : l.event.trim() || 'Línea');
export const lineSubtitle = (l: Line) => { const b = l.black.trim(); return b && b !== '?' ? b : ''; };

/* ---------------- the session ---------------- */

export type RunStatus = 'ready' | 'play' | 'between' | 'done';

export interface LineEnd {
  key: string;
  clean: boolean;
  pass: number;
  /** average ms per move on this line's first pass (null on a repetition) */
  avgMs: number | null;
  next: 'repeat' | 'next' | 'finish';
}

export interface FailEntry {
  node: string;
  fen: string;
  color: 'w' | 'b';
  expected: string;
  expectedSan: string;
  played: string;
  playedSan: string;
  count: number;
  lineKey: string;
  title: string;
}

export interface LineResult { key: string; firstClean: boolean; avgMs: number | null; passes: number }

export type MoveResult =
  | { kind: 'ok'; move: Move; end?: LineEnd }
  | { kind: 'wrong'; uci: string }
  | { kind: 'ignored' };

/** What is kept on the device after each move, to resume after closing the app. */
export interface Snapshot {
  v: 1;
  worldId: string;
  mode: NeteroMode;
  scope: NeteroScope | null;
  fp: string | null;
  eligible: boolean;
  inScope: number;
  activeInScope: number;
  lines: { key: string; repId: string }[];
  status: RunStatus;
  idx: number;
  pass: number;
  ply: number;
  passFails: number;
  attempts: number;
  nodeMs: number;
  firstMs: number;
  firstMoves: number;
  curFirstClean: boolean | null;
  curAvgMs: number | null;
  nodes: [string, { ok: boolean; ms: number }][];
  fails: number;
  failLog: FailEntry[];
  failedLines: string[];
  results: LineResult[];
  lastEnd: LineEnd | null;
  activeMs: number;
  startedAt: string;
  savedAt: string;
}

const fen4 = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
const uciObj = (u: string) => ({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: u[4] });

export class NeteroRun {
  status: RunStatus = 'ready';
  paused = false;
  idx = 0;
  /** 1: the first pass (the exam); 2 and on: mandatory repetitions */
  pass = 1;
  ply = 0;
  passFails = 0;
  /** wrong tries at the current node */
  attempts = 0;
  fails = 0;
  chess!: Chess;
  moves: string[] = [];
  lastMove: [Square, Square] | undefined;
  /** first appearance of each node: right at the first try, and its time */
  nodes = new Map<string, { ok: boolean; ms: number }>();
  failLog = new Map<string, FailEntry>();
  failedLines = new Set<string>();
  results: LineResult[] = [];
  lastEnd: LineEnd | null = null;
  startedAt = new Date().toISOString();
  private activeMs = 0;
  private activeSince: number | null = null;
  private segStart: number | null = null;
  private nodeMs = 0;
  private firstMs = 0;
  private firstMoves = 0;
  private curFirstClean: boolean | null = null;
  private curAvgMs: number | null = null;

  constructor(public plan: Plan, public worldId: string, private now: () => number = () => performance.now()) {
    this.setupLine();
  }

  get total() { return this.plan.lines.length; }
  get item(): PlanLine { return this.plan.lines[Math.min(this.idx, this.plan.lines.length - 1)]; }
  get color(): 'w' | 'b' { return this.item.rep.color; }
  get running() { return this.status === 'play' && !this.paused; }
  get userTurn() { return this.running && this.ply < this.moves.length && this.chess.turn() === this.color; }
  /** The rival's move is due (the screen plays it after a short pause). */
  get autoDue() { return this.running && this.ply < this.moves.length && this.chess.turn() !== this.color; }
  get expected(): string | undefined { return this.ply < this.moves.length ? this.moves[this.ply] : undefined; }
  /** Session time so far: repetitions included, pauses left out. */
  get elapsedMs() { return this.activeMs + (this.activeSince !== null ? Math.max(0, this.now() - this.activeSince) : 0); }
  get canHint() { return this.userTurn && this.attempts >= HINT_AFTER; }

  /** The score from the nodes seen so far. */
  get live(): Score & { nodes: number; firstTry: number; thinkMs: number } {
    let firstTry = 0, thinkMs = 0;
    for (const n of this.nodes.values()) { if (n.ok) firstTry++; thinkMs += n.ms; }
    return { ...neteroScore(this.nodes.size, firstTry, thinkMs), nodes: this.nodes.size, firstTry, thinkMs };
  }

  private setupLine() {
    const it = this.item;
    this.chess = new Chess(it.line.fen ?? START_FEN);
    this.moves = it.line.uci.split(' ').filter(Boolean);
    this.ply = 0;
    this.passFails = 0;
    this.attempts = 0;
    this.nodeMs = 0;
    this.segStart = null;
    this.lastMove = undefined;
    if (this.pass === 1) { this.firstMs = 0; this.firstMoves = 0; this.curFirstClean = null; this.curAvgMs = null; }
  }

  /** The position is on the board and waiting for the player: their time starts (after `delay` of animation). */
  private ready(delay = 0) {
    this.segStart = this.userTurn ? this.now() + delay : null;
  }

  /** «Comenzar»: the session clock starts. */
  begin() {
    if (this.status !== 'ready') return;
    this.status = 'play';
    this.paused = false;
    this.activeSince = this.now();
    this.ready();
  }

  pause() {
    if (this.paused || this.status === 'done') return;
    this.paused = true;
    const t = this.now();
    if (this.activeSince !== null) { this.activeMs += Math.max(0, t - this.activeSince); this.activeSince = null; }
    if (this.segStart !== null) { this.nodeMs += Math.max(0, t - this.segStart); this.segStart = null; }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.status === 'ready' || this.status === 'done') return;
    this.activeSince = this.now();
    this.ready();
  }

  /** The rival's move of the line. */
  autoMove(): { move: Move; end?: LineEnd } | null {
    if (!this.autoDue) return null;
    const move = this.chess.move(uciObj(this.moves[this.ply]));
    this.ply++;
    this.lastMove = [move.from, move.to];
    if (this.ply >= this.moves.length) return { move, end: this.endLine() };
    this.ready(ANIM_MS);
    return { move };
  }

  /** The player's move: right, or a fail (taken back: the same position waits for another try). */
  userMove(uci: string): MoveResult {
    if (!this.userTurn) return { kind: 'ignored' };
    const exp = this.expected!;
    const fen = this.chess.fen();
    let playedSan = uci;
    if (uci !== exp) {
      // only legal moves count (the board offers no others)
      try { playedSan = new Chess(fen).move(uciObj(uci)).san; } catch { return { kind: 'ignored' }; }
    }
    const t = this.now();
    if (this.segStart !== null) this.nodeMs += Math.max(0, t - this.segStart);
    const node = `${fen4(fen)}|${exp}`;
    if (uci !== exp) {
      this.fails++;
      this.passFails++;
      this.attempts++;
      this.failedLines.add(this.item.key);
      const prev = this.failLog.get(node);
      let expectedSan = exp;
      try { expectedSan = new Chess(fen).move(uciObj(exp)).san; } catch { /* keep uci */ }
      this.failLog.set(node, {
        node, fen, color: this.color, expected: exp, expectedSan, played: uci, playedSan,
        count: (prev?.count ?? 0) + 1, lineKey: this.item.key, title: lineTitle(this.item.line),
      });
      this.segStart = t + WRONG_MS;
      return { kind: 'wrong', uci };
    }
    if (!this.nodes.has(node)) this.nodes.set(node, { ok: this.attempts === 0, ms: Math.round(this.nodeMs) });
    if (this.pass === 1) { this.firstMs += this.nodeMs; this.firstMoves++; }
    this.nodeMs = 0;
    this.attempts = 0;
    this.segStart = null;
    const move = this.chess.move(uciObj(exp));
    this.ply++;
    this.lastMove = [move.from, move.to];
    if (this.ply >= this.moves.length) return { kind: 'ok', move, end: this.endLine() };
    return { kind: 'ok', move };
  }

  /** After a few wrong tries the move can be shown (the node already counts as failed). */
  hint(): string | undefined {
    return this.canHint ? this.expected : undefined;
  }

  private endLine(): LineEnd {
    const clean = this.passFails === 0;
    if (this.pass === 1) {
      this.curFirstClean = clean;
      this.curAvgMs = this.firstMoves ? this.firstMs / this.firstMoves : null;
    }
    const last = this.idx + 1 >= this.total;
    const next = clean ? (last ? 'finish' : 'next') : 'repeat';
    if (clean) this.results.push({ key: this.item.key, firstClean: !!this.curFirstClean, avgMs: this.curAvgMs, passes: this.pass });
    this.lastEnd = { key: this.item.key, clean, pass: this.pass, avgMs: this.pass === 1 ? this.curAvgMs : null, next };
    this.status = 'between';
    this.segStart = null;
    return this.lastEnd;
  }

  /** After the pause between lines: the repetition, the next line, or the end. */
  next(): 'repeat' | 'next' | 'finish' | null {
    if (this.status !== 'between' || !this.lastEnd || this.paused) return null;
    const step = this.lastEnd.next;
    if (step === 'finish') {
      this.status = 'done';
      if (this.activeSince !== null) { this.activeMs += Math.max(0, this.now() - this.activeSince); this.activeSince = null; }
      return step;
    }
    if (step === 'repeat') this.pass++;
    else { this.idx++; this.pass = 1; }
    this.setupLine();
    this.status = 'play';
    // the board animates back to the start of the line before the player can read it
    this.ready(ANIM_MS);
    return step;
  }

  /** The finished session, as sent to the server. */
  summary(device: NeteroDevice, day: string): NeteroSummary {
    const s = this.live;
    return {
      mode: this.plan.mode, scope: this.plan.scope, fp: this.plan.fp, eligible: this.plan.eligible,
      nodes: s.nodes, firstTry: s.firstTry, thinkMs: Math.round(s.thinkMs), totalMs: Math.round(this.elapsedMs),
      fails: this.fails, lines: this.total, device, day,
      lineMs: this.results.filter((r) => r.avgMs !== null).map((r) => ({ k: r.key, ms: Math.round(r.avgMs!) })),
      failed: [...this.failedLines],
      clean: this.results.filter((r) => r.firstClean).map((r) => r.key),
    };
  }

  /** Fails grouped by node, most repeated first. */
  get failList(): FailEntry[] {
    return [...this.failLog.values()].sort((a, b) => b.count - a.count);
  }

  snapshot(): Snapshot {
    return {
      v: 1, worldId: this.worldId, mode: this.plan.mode, scope: this.plan.scope, fp: this.plan.fp, eligible: this.plan.eligible,
      inScope: this.plan.inScope, activeInScope: this.plan.activeInScope,
      lines: this.plan.lines.map((x) => ({ key: x.key, repId: x.rep.id })),
      status: this.status, idx: this.idx, pass: this.pass, ply: this.ply, passFails: this.passFails, attempts: this.attempts,
      nodeMs: this.nodeMs + (this.segStart !== null ? Math.max(0, this.now() - this.segStart) : 0),
      firstMs: this.firstMs, firstMoves: this.firstMoves, curFirstClean: this.curFirstClean, curAvgMs: this.curAvgMs,
      nodes: [...this.nodes.entries()], fails: this.fails, failLog: [...this.failLog.values()], failedLines: [...this.failedLines],
      results: this.results, lastEnd: this.lastEnd, activeMs: this.elapsedMs, startedAt: this.startedAt, savedAt: new Date().toISOString(),
    };
  }

  /**
   * Rebuild a session saved on the device. It comes back paused. Returns null when the repertoire changed
   * and a line of the session is no longer there.
   */
  static restore(s: Snapshot, reps: Repertoire[], now?: () => number): NeteroRun | null {
    if (!s || s.v !== 1 || !Array.isArray(s.lines) || !s.lines.length || s.status === 'done') return null;
    const byKey = new Map<string, PlanLine>();
    for (const rep of reps) for (const line of rep.lines) { const key = lineKey(line); if (!byKey.has(key)) byKey.set(key, { key, rep, line }); }
    const lines: PlanLine[] = [];
    for (const l of s.lines) { const x = byKey.get(l.key); if (!x) return null; lines.push(x); }
    if (s.idx < 0 || s.idx >= lines.length) return null;
    const plan: Plan = { mode: s.mode, scope: s.scope, fp: s.fp, eligible: s.eligible, lines, inScope: s.inScope, activeInScope: s.activeInScope };
    const run = new NeteroRun(plan, s.worldId, now);
    run.idx = s.idx;
    run.pass = s.pass;
    run.setupLine();
    if (s.ply > run.moves.length) return null;
    try { for (let i = 0; i < s.ply; i++) { const m = run.chess.move(uciObj(run.moves[i])); run.lastMove = [m.from, m.to]; } } catch { return null; }
    run.ply = s.ply;
    run.status = s.status === 'ready' ? 'ready' : s.status;
    run.paused = s.status !== 'ready';
    run.passFails = s.passFails;
    run.attempts = s.attempts;
    run.nodeMs = s.nodeMs;
    run.firstMs = s.firstMs;
    run.firstMoves = s.firstMoves;
    run.curFirstClean = s.curFirstClean;
    run.curAvgMs = s.curAvgMs;
    run.nodes = new Map(s.nodes);
    run.fails = s.fails;
    run.failLog = new Map(s.failLog.map((f) => [f.node, f]));
    run.failedLines = new Set(s.failedLines);
    run.results = s.results;
    run.lastEnd = s.lastEnd;
    run.activeMs = s.activeMs;
    run.startedAt = s.startedAt;
    return run;
  }
}

/** Phone or computer: times are not comparable between the two. */
export function deviceKind(): NeteroDevice {
  try { return matchMedia('(pointer: coarse)').matches ? 'movil' : 'pc'; } catch { return 'pc'; }
}

/** 83 450 ms → "1:23"; over an hour, "1:02:03". */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

/** 1834 ms → "1,8 s" (seconds with one decimal, Spanish style). */
export const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
