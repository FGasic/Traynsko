import { fmtClk } from './clock';
import { START_FEN } from './pgn';

import type { GameRecord } from '../../shared/types';
export type { GameRecord };

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function gameToPgn(g: GameRecord): string {
  const d = new Date(g.date);
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const bot = `${g.botName} (bot ${g.botElo})`;
  const white = g.userColor === 'w' ? g.playerName : bot;
  const black = g.userColor === 'w' ? bot : g.playerName;
  const variation = [g.lineWhite, g.lineBlack].filter((s) => s && s !== '?').join(' · ');
  const tags: [string, string][] = [
    ['Event', `${g.worldName} · ${g.repName}`],
    ['Site', 'Traynsko'],
    ['Date', date],
    ['Round', '-'],
    ['White', white],
    ['Black', black],
    ['Result', g.result],
    ['TimeControl', g.timeControl],
    ['Opening', g.lineEvent || g.repName],
    ['Variation', variation],
    ['Termination', g.termination],
    ['Annotator', `Traynsko · ${g.lineErrors} error(es) en la línea`],
  ];
  const fen = g.startFen && g.startFen !== START_FEN ? g.startFen : undefined;
  if (fen) tags.push(['SetUp', '1'], ['FEN', fen]);

  // Move text
  const parts: string[] = [];
  const startTurn = fen ? fen.split(' ')[1] : 'w';
  let moveNo = fen ? Number(fen.split(' ')[5]) : 1;
  let turn = startTurn;
  g.sans.forEach((san, i) => {
    if (turn === 'w') parts.push(`${moveNo}.`);
    else if (i === 0) parts.push(`${moveNo}...`);
    parts.push(san);
    parts.push(`{[%clk ${fmtClk(g.clocks[i] ?? 0)}]}`);
    if (i === g.linePlies - 1) parts.push('{Fin de la línea de repertorio}');
    if (turn === 'b') moveNo++;
    turn = turn === 'w' ? 'b' : 'w';
  });
  parts.push(g.result);

  // wrap at 80 chars
  const lines: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + ' ' + p).length > 80) { lines.push(cur); cur = p; }
    else cur = cur ? cur + ' ' + p : p;
  }
  if (cur) lines.push(cur);

  return tags.map(([k, v]) => `[${k} "${esc(v)}"]`).join('\n') + '\n\n' + lines.join('\n') + '\n';
}

export function gamesToPgn(games: GameRecord[]): string {
  return [...games].sort((a, b) => a.date.localeCompare(b.date)).map(gameToPgn).join('\n');
}
