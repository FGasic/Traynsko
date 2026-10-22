/**
 * The player's selection of lines and their sets: the Biblioteca edits it, the training uses it.
 * Pure functions only; storage and sync live in App.
 */
import { Chess } from 'chess.js';
import type { Line, Repertoire } from '../../shared/types';
import { lineKey, type LineSet, type Picks } from '../../shared/picks';
import { START_FEN } from './pgn';

export { lineKey, emptyPicks, cleanPicks, type Picks, type LineSet } from '../../shared/picks';

/* ---------------- training ---------------- */

export const offSet = (p: Picks | null) => new Set(p?.off ?? []);

/** Lines of a chapter that are in training. */
export const activeIn = (rep: Repertoire, off: Set<string>) => rep.lines.filter((l) => !off.has(lineKey(l)));

/* ---------------- what the Biblioteca shows of each line ---------------- */

export interface LineView {
  rep: Repertoire;
  line: Line;
  key: string;
  /** position of the line in its chapter (0-based) */
  index: number;
  sans: string[];
  startNo: number;
  startTurn: 'w' | 'b';
  /** first ply where this line leaves every other line of its chapter */
  diverge: number;
}

/** Replays every line once to get its moves in SAN. Memoise the result: it is the expensive part. */
export function buildIndex(reps: Repertoire[]): Map<string, LineView[]> {
  const out = new Map<string, LineView[]>();
  for (const rep of reps) {
    const views: LineView[] = rep.lines.map((line, index) => {
      const fen = line.fen ?? START_FEN;
      const parts = fen.split(' ');
      let sans: string[] = [];
      try {
        const c = new Chess(fen);
        for (const u of line.uci.split(' ').filter(Boolean)) sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
      } catch { sans = sans.length ? sans : []; }
      return { rep, line, key: lineKey(line), index, sans, startNo: Number(parts[5]) || 1, startTurn: parts[1] === 'b' ? 'b' : 'w', diverge: 0 };
    });
    // the moves that tell a line apart: compare each one with its neighbours in move order
    const sorted = [...views].sort((a, b) => ((a.line.fen ?? '') + a.line.uci < (b.line.fen ?? '') + b.line.uci ? -1 : 1));
    const lcp = (a: LineView, b: LineView) => {
      if ((a.line.fen ?? '') !== (b.line.fen ?? '')) return 0;
      const x = a.line.uci.split(' '), y = b.line.uci.split(' ');
      let i = 0;
      while (i < x.length && i < y.length && x[i] === y[i]) i++;
      return i;
    };
    sorted.forEach((v, i) => {
      v.diverge = Math.max(i > 0 ? lcp(v, sorted[i - 1]) : 0, i < sorted.length - 1 ? lcp(v, sorted[i + 1]) : 0);
    });
    out.set(rep.id, views);
  }
  return out;
}

export function plyInfo(v: Pick<LineView, 'startNo' | 'startTurn'>, ply: number): { no: number; side: 'w' | 'b' } {
  const k = ply + (v.startTurn === 'b' ? 1 : 0);
  return { no: v.startNo + Math.floor(k / 2), side: k % 2 === 0 ? 'w' : 'b' };
}

export interface MoveToken { text: string; hit: boolean; num?: string }

/** Moves from ply `a` to `b` (exclusive) as tokens: "12.Be3", "b5", or "12…b5" when it starts with Black. */
export function moveTokens(v: LineView, a: number, b: number, hits?: Set<number>): MoveToken[] {
  const out: MoveToken[] = [];
  for (let i = Math.max(0, a); i < Math.min(b, v.sans.length); i++) {
    const { no, side } = plyInfo(v, i);
    const num = side === 'w' ? `${no}.` : i === a ? `${no}…` : undefined;
    out.push({ text: v.sans[i], hit: !!hits?.has(i), num });
  }
  return out;
}

/** The short excerpt shown for a line: around a search hit, or where it leaves its siblings. */
export function excerpt(v: LineView, hits?: Set<number>): { tokens: MoveToken[]; head: boolean; tail: boolean } {
  const n = v.sans.length;
  let a: number;
  if (hits && hits.size) a = Math.max(0, Math.min(...hits) - 2);
  else a = Math.min(Math.max(0, v.diverge - 1), Math.max(0, n - 4));
  const b = Math.min(n, a + 6);
  return { tokens: moveTokens(v, a, b, hits), head: a > 0, tail: b < n };
}

export const lineTitle = (l: Line, index: number) => l.white.trim() && l.white.trim() !== '?' ? l.white.trim() : l.event.trim() || `Línea ${index + 1}`;
export const lineSub = (l: Line) => {
  const b = l.black.trim();
  return b && b !== '?' ? b : '';
};

/* ---------------- search: by name or by move ---------------- */

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Spanish and English piece letters (R is "rey" in Spanish and "rook" in English: both are tried)
const PIECE: Record<string, string[]> = { k: ['K'], q: ['Q'], d: ['Q'], r: ['R', 'K'], t: ['R'], b: ['B'], a: ['B'], n: ['N'], c: ['N'] };
const PROMO: Record<string, string> = { q: 'Q', d: 'Q', r: 'R', t: 'R', b: 'B', a: 'B', n: 'N', c: 'N' };

/** Every English SAN a typed move may stand for (check marks dropped), or null when it isn't a move. */
export function moveCandidates(token: string): string[] | null {
  const t = token.replace(/[+#!?]+$/, '').trim();
  if (!t) return null;
  if (/^[oO0]-[oO0](-[oO0])?$/.test(t)) return [t.length > 3 ? 'O-O-O' : 'O-O'];
  const out = new Set<string>();
  // pawn moves: e4, E4, exd5, e8=Q, e8D, bxa1=C
  const pawn = t.match(/^(?:([a-h])x([a-h])|([a-hA-H]))([1-8])(?:=?([qdrtbancQDRTBANC]))?$/);
  if (pawn) {
    const [, from, to, file, rank, pr] = pawn;
    const sq = from ? `${from}x${to}${rank}` : `${file.toLowerCase()}${rank}`;
    const last = rank === '8' || rank === '1';
    if (pr && last) out.add(`${sq}=${PROMO[pr.toLowerCase()]}`);
    else if (!pr && last) ['Q', 'R', 'B', 'N'].forEach((P) => out.add(`${sq}=${P}`));
    if (!pr) out.add(sq);
  }
  // piece moves: Nf3, Cf3, Ae3, Rxf1, N1d2, Tad1 (lower case works too: cf3, ae3)
  const m = t.match(/^([kqrtbandcKQRTBANDC])([a-h]?[1-8]?)(x?)([a-h][1-8])$/);
  if (m) for (const P of PIECE[m[1].toLowerCase()] ?? []) out.add(`${P}${m[2]}${m[3]}${m[4]}`);
  return out.size ? [...out] : null;
}

const PIECE_SAN = /^([KQRBN])([a-h]?[1-8]?)(x?)([a-h][1-8])$/;

/**
 * A typed move against a move of the line. Typed piece moves may leave out what the line's notation adds:
 * "Nd7" finds "Nbd7", and "Nd4" finds "Nxd4"; anything typed must be there.
 */
export function sanMatches(typed: string, san: string): boolean {
  const s = san.replace(/[+#]$/, '');
  if (typed === s) return true;
  const q = typed.match(PIECE_SAN), m = s.match(PIECE_SAN);
  if (!q || !m || q[1] !== m[1] || q[4] !== m[4]) return false;
  if (q[3] && !m[3]) return false;
  if (q[2] && q[2] !== m[2] && !m[2].includes(q[2])) return false;
  return true;
}

interface Term { text: string; move?: { no?: number; side?: 'w' | 'b'; sans: string[] } }
export interface Query { raw: string; terms: Term[] }

export function parseQuery(q: string): Query | null {
  const raw = q.trim();
  if (!raw) return null;
  // "12. Be3" and "12... Be6" are one term
  const joined = raw.replace(/(\d+)\s*(\.{1,3}|…)\s+(?=\S)/g, '$1$2');
  const terms: Term[] = joined.split(/\s+/).filter(Boolean).map((tok) => {
    const term: Term = { text: fold(tok) };
    const m: (string | undefined)[] | null = /^[oO0]-[oO0]/.test(tok) ? [tok, undefined, undefined, tok] : tok.match(/^(?:(\d{1,3})(\.\.\.|…|\.))?(.+)$/);
    if (m) {
      const sans = moveCandidates(m[3] ?? '');
      if (sans) term.move = { no: m[1] ? Number(m[1]) : undefined, side: m[2] ? (m[2] === '.' ? 'w' : 'b') : undefined, sans };
    }
    return term;
  });
  return { raw, terms };
}

const nameText = (v: LineView) => fold(`${v.line.white} ${v.line.black} ${v.line.event}`);

/** Whether a line matches every term; `plies` are the moves that matched, to highlight them. */
export function matchLine(v: LineView, q: Query): { ok: boolean; plies: Set<number> } {
  const plies = new Set<number>();
  const name = nameText(v);
  for (const t of q.terms) {
    let ok = name.includes(t.text);
    if (t.move) {
      for (let i = 0; i < v.sans.length; i++) {
        if (!t.move.sans.some((c) => sanMatches(c, v.sans[i]))) continue;
        const info = plyInfo(v, i);
        if (t.move.no !== undefined && info.no !== t.move.no) continue;
        if (t.move.side && info.side !== t.move.side) continue;
        plies.add(i);
        ok = true;
      }
    }
    if (!ok) return { ok: false, plies };
  }
  return { ok: true, plies };
}

/* ---------------- sets in a chapter ---------------- */

export interface ChapterLayout { sets: { set: LineSet; lines: LineView[] }[]; loose: LineView[] }

/**
 * How a chapter shows: the player's sets that hold any of its lines (in their order), then the lines in no set.
 * An empty set shows in the chapter where it was created (or the first one, if that chapter is gone).
 */
export function layoutChapter(views: LineView[], picks: Picks, _repIds?: string[]): ChapterLayout {
  const owner = new Map<string, string>();
  picks.sets.forEach((s) => s.lines.forEach((k) => { if (!owner.has(k)) owner.set(k, s.id); }));
  const bySet = new Map<string, LineView[]>();
  const loose: LineView[] = [];
  for (const v of views) {
    const id = owner.get(v.key);
    if (id) { if (!bySet.has(id)) bySet.set(id, []); bySet.get(id)!.push(v); } else loose.push(v);
  }
  return { sets: picks.sets.filter((s) => bySet.has(s.id)).map((s) => ({ set: s, lines: bySet.get(s.id)! })), loose };
}

/** Sets with none of the world's lines: shown in the chapter they were created in. */
export function emptySetsFor(repId: string, picks: Picks, allKeys: Set<string>, repIds: string[]): LineSet[] {
  return picks.sets.filter((s) => !s.lines.some((k) => allKeys.has(k)) && (s.rep === repId || ((!s.rep || !repIds.includes(s.rep)) && repIds[0] === repId)));
}

/* ---------------- changes (each returns a new value) ---------------- */

const stamp = (p: Picks): Picks => ({ ...p, at: new Date().toISOString() });
const newSetId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(-10);

export function setLinesOn(p: Picks, keys: string[], on: boolean): Picks {
  const off = new Set(p.off);
  keys.forEach((k) => (on ? off.delete(k) : off.add(k)));
  return stamp({ ...p, off: [...off] });
}

/** Train only these lines: every other line of the repertoire goes out. */
export function onlyLines(p: Picks, keys: string[], allKeys: string[]): Picks {
  const keep = new Set(keys);
  const known = new Set(allKeys);
  // lines of other versions of the repertoire keep their state
  const off = p.off.filter((k) => !known.has(k));
  allKeys.forEach((k) => { if (!keep.has(k)) off.push(k); });
  return stamp({ ...p, off: [...new Set(off)] });
}

export function moveLines(p: Picks, keys: string[], setId: string | null): Picks {
  const moving = new Set(keys);
  const sets = p.sets.map((s) => {
    const rest = s.lines.filter((k) => !moving.has(k));
    return s.id === setId ? { ...s, lines: [...rest, ...keys.filter((k) => !rest.includes(k))] } : rest.length === s.lines.length ? s : { ...s, lines: rest };
  });
  return stamp({ ...p, sets });
}

export function createSet(p: Picks, name: string, rep: string, keys: string[] = []): { picks: Picks; id: string } {
  const id = newSetId();
  const set: LineSet = { id, name: name.trim().slice(0, 60) || 'Conjunto', lines: [], rep };
  const withSet = { ...p, sets: [...p.sets, set] };
  return { picks: keys.length ? moveLines(withSet, keys, id) : stamp(withSet), id };
}

export function renameSet(p: Picks, id: string, name: string): Picks {
  const n = name.trim().slice(0, 60);
  return n ? stamp({ ...p, sets: p.sets.map((s) => (s.id === id ? { ...s, name: n } : s)) }) : p;
}

export function deleteSet(p: Picks, id: string): Picks {
  return stamp({ ...p, sets: p.sets.filter((s) => s.id !== id) });
}

export function foldSet(p: Picks, id: string, closed: boolean): Picks {
  return stamp({ ...p, sets: p.sets.map((s) => (s.id === id ? (closed ? { ...s, closed: true } : (({ closed: _c, ...rest }) => rest)(s)) : s)) });
}

/** Move a set one place up or down among the sets shown in the same chapter. */
export function shiftSet(p: Picks, id: string, dir: -1 | 1, visibleIds: string[]): Picks {
  const i = visibleIds.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= visibleIds.length) return p;
  const a = p.sets.findIndex((s) => s.id === id), b = p.sets.findIndex((s) => s.id === visibleIds[j]);
  const sets = [...p.sets];
  [sets[a], sets[b]] = [sets[b], sets[a]];
  return stamp({ ...p, sets });
}

/** Old devices kept switched-off chapters in their settings: the same choice, as lines. */
export function fromDisabledChapters(reps: Repertoire[], disabled: string[]): Picks | null {
  const off = reps.filter((r) => disabled.includes(r.id)).flatMap((r) => r.lines.map(lineKey));
  return off.length ? { v: 1, off, sets: [], at: new Date().toISOString() } : null;
}
