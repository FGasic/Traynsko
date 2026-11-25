/**
 * Modo Netero: shared by the browser app (which plays the session) and the server (which keeps records,
 * best times per line, the queue of lines to review and the daily streak).
 *
 * Principle: the retry is training, the first pass is the exam. Only the first appearance of each node
 * (a position where the player moves, with its expected move) counts towards the score.
 */
import { cyrb53, lineFingerprint } from './atlas';
import { lineKey } from './picks';
import type { Line } from './types';

export const NETERO = {
  /** Average thinking time per node that still scores 100 (provisional: calibrate with real sessions). */
  t100Ms: 2000,
  /** Lines in a daily Netero, by default, and the choices offered. */
  dailyDefault: 5,
  dailyOptions: [3, 5, 10],
  /** Versions kept per scope: the current record and a few previous ones. */
  keepVersions: 6,
  /** Lines remembered for review (most recent first). */
  queueMax: 200,
  /** Best times kept per person and repertoire. */
  bestMax: 6000,
};

export type NeteroMode = 'full' | 'daily' | 'errors';
export type NeteroDevice = 'movil' | 'pc';
export type ScopeKind = 'world' | 'rep';

/** What a full Netero covers: the whole repertoire, or one chapter. */
export interface NeteroScope { kind: ScopeKind; id: string; name: string }

export interface NeteroRecord {
  /** fingerprint of the scope's lines when the record was set: a change of content starts a new version */
  fp: string;
  scope: NeteroScope;
  nota: number;
  precision: number;
  ritmo: number;
  nodes: number;
  firstTry: number;
  thinkMs: number;
  totalMs: number;
  fails: number;
  lines: number;
  date: string;
  device: NeteroDevice;
}

export interface NeteroStreak { cur: number; best: number; last: string }

/** Everything Netero keeps for one person in one repertoire (the streak is per account). */
export interface NeteroState {
  records: NeteroRecord[];
  /** best average time per move on a line's first pass (ms), by line key */
  best: Record<string, number>;
  /** line keys with recent fails, most recent first: the daily Netero takes them first */
  queue: string[];
  streak: NeteroStreak;
}

/** A finished session, as the app sends it. */
export interface NeteroSummary {
  mode: NeteroMode;
  scope: NeteroScope | null;
  fp: string | null;
  /** every line of the scope was active: the session may set a record */
  eligible: boolean;
  nodes: number;
  firstTry: number;
  thinkMs: number;
  totalMs: number;
  fails: number;
  lines: number;
  device: NeteroDevice;
  /** the player's local date (YYYY-MM-DD), for the streak */
  day: string;
  /** average ms per move on each line's first pass */
  lineMs: { k: string; ms: number }[];
  /** lines with any fail in this session */
  failed: string[];
  /** lines completed without errors on their first pass */
  clean: string[];
}

export interface Score { precision: number; ritmo: number; nota: number }

/** Nota = 100 × P × R, with P = nodes right at the first try / nodes, R = min(1, t₁₀₀ / mean time per node). */
export function neteroScore(nodes: number, firstTry: number, thinkMs: number, t100 = NETERO.t100Ms): Score {
  if (nodes <= 0) return { precision: 0, ritmo: 0, nota: 0 };
  const precision = Math.max(0, Math.min(1, firstTry / nodes));
  const mean = Math.max(0, thinkMs) / nodes;
  const ritmo = mean <= 0 ? 1 : Math.min(1, t100 / mean);
  return { precision, ritmo, nota: 100 * precision * ritmo };
}

/** Shown as a whole number; compared unrounded. */
export const notaText = (n: number) => String(Math.round(n));

/** Every line of the repertoire (or of one chapter), once each (the same moves in two chapters count once). */
export function scopeLines<R extends { id: string; color: 'w' | 'b'; lines: Line[] }>(reps: R[], scope: { kind: ScopeKind; id: string } | null): { key: string; rep: R; line: Line }[] {
  const seen = new Set<string>();
  const out: { key: string; rep: R; line: Line }[] = [];
  for (const rep of reps) {
    if (scope?.kind === 'rep' && rep.id !== scope.id) continue;
    for (const line of rep.lines) {
      const key = lineKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, rep, line });
    }
  }
  return out;
}

/**
 * Identity of a scope's content: the fingerprints of its lines (side + start + moves), in any order.
 * Renaming keeps it; adding, removing or changing a line gives a new one.
 */
export function scopeFingerprint(lines: { color: 'w' | 'b'; line: Pick<Line, 'fen' | 'uci'> }[]): string {
  const fps = [...new Set(lines.map((x) => lineFingerprint(x.color, x.line)))].sort().join(',');
  return cyrb53(fps, 3) + cyrb53(fps, 5);
}

/* ---------------- days and the streak ---------------- */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function validDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const dayNum = (s: string) => { const m = DAY.exec(s)!; return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5); };
/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);
/** The local date of a moment, as YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const emptyStreak = (): NeteroStreak => ({ cur: 0, best: 0, last: '' });

/** A daily Netero completed on `day`. Only the first of each day counts; the others are practice. */
export function bumpStreak(s: NeteroStreak | null, day: string): { streak: NeteroStreak; counted: boolean } {
  const prev = s ?? emptyStreak();
  if (prev.last && daysBetween(prev.last, day) <= 0) return { streak: prev, counted: false };
  const cur = prev.last && daysBetween(prev.last, day) === 1 ? prev.cur + 1 : 1;
  return { streak: { cur, best: Math.max(prev.best, cur), last: day }, counted: true };
}

/** The streak as it stands today: it is broken once a whole day has gone by without a daily Netero. */
export function liveStreak(s: NeteroStreak | null, today: string): { cur: number; best: number; doneToday: boolean } {
  if (!s || !s.last) return { cur: 0, best: s?.best ?? 0, doneToday: false };
  const gap = daysBetween(s.last, today);
  return { cur: gap <= 1 ? s.cur : 0, best: s.best, doneToday: gap <= 0 };
}

/* ---------------- records ---------------- */

const sameScope = (a: NeteroScope, b: NeteroScope) => a.kind === b.kind && (a.id === b.id || (a.kind === 'rep' && a.name === b.name));

/** The record for this exact content, and the latest one of a previous version of the same scope. */
export function recordFor(records: NeteroRecord[], scope: NeteroScope, fp: string): { current: NeteroRecord | null; previous: NeteroRecord | null } {
  const current = records.find((r) => r.fp === fp && r.scope.kind === scope.kind) ?? null;
  const previous = records
    .filter((r) => r.fp !== fp && sameScope(r.scope, scope))
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  return { current, previous };
}

/**
 * Store a session's result. A record is replaced only by a strictly higher nota (unrounded); a new content
 * fingerprint starts a new version. Old versions beyond `keepVersions` per scope are dropped.
 */
export function applyRecord(records: NeteroRecord[], rec: NeteroRecord): { records: NeteroRecord[]; isRecord: boolean; prev: NeteroRecord | null } {
  const i = records.findIndex((r) => r.fp === rec.fp && r.scope.kind === rec.scope.kind);
  const prev = i >= 0 ? records[i] : null;
  if (prev && rec.nota <= prev.nota) return { records, isRecord: false, prev };
  const next = records.filter((_, j) => j !== i);
  next.push(rec);
  // keep a few versions per scope (most recent first)
  const kept: NeteroRecord[] = [];
  const sorted = [...next].sort((a, b) => b.date.localeCompare(a.date));
  for (const r of sorted) {
    if (kept.filter((k) => sameScope(k.scope, r.scope)).length < NETERO.keepVersions) kept.push(r);
  }
  return { records: kept, isRecord: true, prev };
}

/** New queue of lines to review: this session's failed lines first; lines done cleanly leave it. */
export function nextQueue(queue: string[], failed: string[], clean: string[]): string[] {
  const out = new Set<string>(failed);
  const drop = new Set(clean);
  for (const k of queue) if (!drop.has(k)) out.add(k);
  return [...out].slice(0, NETERO.queueMax);
}

/** Best average per line: lower is better. */
export function nextBest(best: Record<string, number>, lineMs: { k: string; ms: number }[]): Record<string, number> {
  const out = { ...best };
  for (const { k, ms } of lineMs) if (!(k in out) || ms < out[k]) out[k] = ms;
  const keys = Object.keys(out);
  if (keys.length > NETERO.bestMax) for (const k of keys.slice(0, keys.length - NETERO.bestMax)) delete out[k];
  return out;
}

/* ---------------- untrusted input ---------------- */

const KEY = /^[0-9a-z]{6,16}$/;
const FP = /^[0-9a-z]{16,32}$/;
const ID = /^[0-9A-Za-z_-]{1,40}$/;
const MODES = new Set<NeteroMode>(['full', 'daily', 'errors']);
const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null);
const keys = (v: unknown, max: number) => (Array.isArray(v) && v.length <= max && v.every((k) => typeof k === 'string' && KEY.test(k)) ? [...new Set(v as string[])] : null);

/** Validate a session sent by the app. Returns null when unusable. */
export function cleanSummary(raw: unknown): NeteroSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!MODES.has(r.mode as NeteroMode)) return null;
  const mode = r.mode as NeteroMode;
  let scope: NeteroScope | null = null;
  if (mode === 'full') {
    const s = r.scope as Record<string, unknown> | null;
    if (!s || (s.kind !== 'world' && s.kind !== 'rep') || typeof s.id !== 'string' || !ID.test(s.id) || typeof s.name !== 'string') return null;
    scope = { kind: s.kind, id: s.id, name: s.name.trim().slice(0, 120) };
  }
  const fp = typeof r.fp === 'string' && FP.test(r.fp) ? r.fp : null;
  const nodes = int(r.nodes, 1, 100_000);
  const firstTry = int(r.firstTry, 0, 100_000);
  const thinkMs = int(r.thinkMs, 0, 1e9);
  const totalMs = int(r.totalMs, 0, 1e9);
  const fails = int(r.fails, 0, 1e6);
  const lines = int(r.lines, 1, 10_000);
  if (nodes === null || firstTry === null || thinkMs === null || totalMs === null || fails === null || lines === null || firstTry > nodes) return null;
  if (!validDay(r.day)) return null;
  const failed = keys(r.failed, 10_000);
  const clean = keys(r.clean, 10_000);
  if (!failed || !clean) return null;
  if (!Array.isArray(r.lineMs) || r.lineMs.length > 10_000) return null;
  const lineMs: { k: string; ms: number }[] = [];
  for (const x of r.lineMs as unknown[]) {
    const o = x as Record<string, unknown>;
    const ms = int(o?.ms, 0, 1e8);
    if (!o || typeof o.k !== 'string' || !KEY.test(o.k) || ms === null) return null;
    lineMs.push({ k: o.k, ms });
  }
  return {
    mode, scope, fp, eligible: mode === 'full' && r.eligible === true && !!fp,
    nodes, firstTry, thinkMs, totalMs, fails, lines,
    device: r.device === 'movil' ? 'movil' : 'pc',
    day: r.day as string, lineMs, failed, clean,
  };
}
