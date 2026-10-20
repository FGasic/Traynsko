import { Chess } from 'chess.js';

import type { Line } from '../../shared/types';
export type { Line };

export interface ParseReport {
  lines: Line[];
  trimmedVariations: number;   // games where side variations were removed
  errors: { index: number; name: string; reason: string }[];
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function lineName(l: Pick<Line, 'white' | 'black'>): string {
  return [l.white, l.black].map((s) => s.trim()).filter((s) => s && s !== '?').join(' · ');
}

/** Split a multi-game PGN into raw game texts. */
export function splitGames(text: string): string[] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const games: string[] = [];
  let cur: string[] = [];
  let seenMoves = false;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[') && seenMoves) {
      games.push(cur.join('\n'));
      cur = [];
      seenMoves = false;
    }
    if (line && !line.startsWith('[') && !line.startsWith('%')) seenMoves = true;
    cur.push(raw);
  }
  if (cur.some((l) => l.trim())) games.push(cur.join('\n'));
  return games.filter((g) => /\S/.test(g));
}

function headers(game: string): Record<string, string> {
  const h: Record<string, string> = {};
  const re = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(game))) h[m[1]] = m[2].replace(/\\(.)/g, '$1');
  return h;
}

/** Remove comments, variations, NAGs, move numbers and results; return SAN tokens. */
function mainlineTokens(movetext: string): { tokens: string[]; hadVariations: boolean } {
  let s = movetext.replace(/\{[^}]*\}/g, ' ');           // { comments }
  s = s.replace(/;[^\n]*/g, ' ');                          // ; comments
  let hadVariations = false;
  // strip nested ( variations )
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') { depth++; hadVariations = true; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) out += ch;
  }
  s = out.replace(/\$\d+/g, ' ');
  const tokens = s
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, '').replace(/^\.+/, ''))
    .map((t) => t.replace(/[!?]+$/, '').replace(/[+#]+$/, (x) => x[0]))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t) && !/^\d+\.*$/.test(t))
    .map((t) => t.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O'));
  return { tokens, hadVariations };
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function parseRepertoire(text: string): ParseReport {
  const report: ParseReport = { lines: [], trimmedVariations: 0, errors: [] };
  const seen = new Set<string>();
  splitGames(text).forEach((game, index) => {
    const h = headers(game);
    const name = lineName({ white: h.White ?? '', black: h.Black ?? '' }) || `Partida ${index + 1}`;
    const movetext = game.split('\n').filter((l) => !l.trim().startsWith('[')).join('\n');
    const { tokens, hadVariations } = mainlineTokens(movetext);
    if (hadVariations) report.trimmedVariations++;
    const fen = h.SetUp === '1' && h.FEN ? h.FEN : undefined;
    let chess: Chess;
    try { chess = new Chess(fen ?? START_FEN); } catch { report.errors.push({ index, name, reason: 'FEN inicial no válido' }); return; }
    const uci: string[] = [];
    for (const san of tokens) {
      try {
        const mv = chess.move(san, { strict: false });
        uci.push(mv.from + mv.to + (mv.promotion ?? ''));
      } catch {
        report.errors.push({ index, name, reason: `Jugada no válida: ${san} (tras ${uci.length} medias jugadas)` });
        return;
      }
    }
    if (uci.length === 0) { report.errors.push({ index, name, reason: 'La partida no tiene jugadas' }); return; }
    const key = (fen ?? '') + uci.join(' ');
    if (seen.has(key)) return; // exact duplicate line
    seen.add(key);
    report.lines.push({
      id: hash(key + name),
      event: (h.Event ?? '').replace(/^\?$/, ''),
      white: h.White ?? '',
      black: h.Black ?? '',
      ...(fen ? { fen } : {}),
      uci: uci.join(' '),
    });
  });
  return report;
}

export { START_FEN };
