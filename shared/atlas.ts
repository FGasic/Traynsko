/** Accounts and medals: shared by the browser app and the server. */
import type { Line } from './types';

/** OAuth client id shown to the player on Lichess's consent screen (Lichess needs no registration). */
export const LICHESS_CLIENT_ID = 'traynsko';

/** Games saved with an account use this player key prefix; guest names can never produce it. */
export const ACCOUNT_PREFIX = 'lichess:';
export const accountKey = (lichessId: string) => ACCOUNT_PREFIX + lichessId;

export interface UserInfo { id: string; name: string }

export interface Medal {
  fp: string;          // line fingerprint: colour + start position + moves (never the name)
  worldId: string;
  repId: string;
  repName: string;
  color: 'w' | 'b';
  event: string;
  white: string;
  black: string;
  plies: number;
  first: string;       // ISO date of the first perfect run
  last: string;        // ISO date of the latest perfect run
  count: number;       // perfect runs from move 1
}

const START4 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

/** 53-bit string hash (cyrb53); two seeds give a 106-bit fingerprint. */
export function cyrb53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

/**
 * Identity of a line for medals: the side you play, the start position and the moves.
 * Renaming a line keeps its medal; changing a move makes it a different line.
 */
export function lineFingerprint(color: 'w' | 'b', line: Pick<Line, 'fen' | 'uci'>): string {
  const fen4 = (line.fen ?? '').trim().split(/\s+/).slice(0, 4).join(' ');
  const start = !fen4 || fen4 === START4 ? '' : fen4;
  const moves = line.uci.trim().split(/\s+/).join(' ');
  const key = `${color}|${start}|${moves}`;
  return cyrb53(key, 1) + cyrb53(key, 7);
}
