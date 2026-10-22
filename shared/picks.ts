/**
 * A player's own arrangement of one repertoire: which lines they train, and the sets they group them in.
 * Shared by the browser app (which edits it) and the server (which stores it per person and repertoire).
 *
 * Lines are identified by their moves (start position + moves), never by chapter or name: when the
 * trainer renames a line or uploads a chapter again, the player's choices stay with the same moves.
 */
import { cyrb53 } from './atlas';
import type { Line } from './types';

export interface LineSet {
  id: string;
  name: string;
  /** line keys, in no particular order (a line belongs to one set at most) */
  lines: string[];
  /** the chapter it was created in: where an empty set is shown */
  rep?: string;
  /** folded: only the title shows */
  closed?: boolean;
}

export interface Picks {
  v: 1;
  /** lines left out of training (everything else is in, including lines added later) */
  off: string[];
  sets: LineSet[];
  /** ISO time of the last change: between two devices, the latest wins */
  at: string;
}

export const PICKS_LIMITS = { sets: 120, setName: 60, keys: 6000, bytes: 240_000 };

const START4 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const KEY = /^[0-9a-z]{6,16}$/;
const ID = /^[0-9A-Za-z]{4,24}$/;

/** Identity of a line for the player's choices: start position and moves (not the side, not the name). */
export function lineKey(line: Pick<Line, 'fen' | 'uci'>): string {
  const fen4 = (line.fen ?? '').trim().split(/\s+/).slice(0, 4).join(' ');
  const start = !fen4 || fen4 === START4 ? '' : fen4;
  return cyrb53(`${start}|${line.uci.trim().split(/\s+/).join(' ')}`, 11);
}

export const emptyPicks = (): Picks => ({ v: 1, off: [], sets: [], at: new Date(0).toISOString() });

/** Validate untrusted input (a request body, or a copy stored on the device). Returns null when unusable. */
export function cleanPicks(raw: unknown): Picks | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.off) || !Array.isArray(r.sets) || typeof r.at !== 'string') return null;
  if (Number.isNaN(Date.parse(r.at))) return null;
  if (r.sets.length > PICKS_LIMITS.sets) return null;
  const off = [...new Set(r.off.filter((k): k is string => typeof k === 'string' && KEY.test(k)))];
  const seen = new Set<string>();
  const ids = new Set<string>();
  let total = off.length;
  const sets: LineSet[] = [];
  for (const s of r.sets as unknown[]) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || ids.has(o.id)) return null;
    if (typeof o.name !== 'string') return null;
    const name = o.name.trim().slice(0, PICKS_LIMITS.setName);
    if (!name || !Array.isArray(o.lines)) return null;
    ids.add(o.id);
    // one set per line: the first one wins
    const lines = (o.lines as unknown[]).filter((k): k is string => typeof k === 'string' && KEY.test(k) && !seen.has(k));
    lines.forEach((k) => seen.add(k));
    total += lines.length;
    const set: LineSet = { id: o.id, name, lines };
    if (typeof o.rep === 'string' && ID.test(o.rep)) set.rep = o.rep;
    if (o.closed === true) set.closed = true;
    sets.push(set);
  }
  if (total > PICKS_LIMITS.keys) return null;
  const out: Picks = { v: 1, off, sets, at: new Date(r.at).toISOString() };
  if (JSON.stringify(out).length > PICKS_LIMITS.bytes) return null;
  return out;
}
