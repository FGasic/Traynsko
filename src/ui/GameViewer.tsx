import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Chess } from 'chess.js';
import { Board } from './Board';
import { BotAvatar, Icon } from './parts';
import { botById } from '../lib/bots';
import type { GameRecord } from '../../shared/types';
import { gameToPgn } from '../lib/pgnOut';
import { fmtClock } from '../lib/clock';
import { START_FEN } from '../lib/pgn';

interface Props {
  game: GameRecord;
  boardTheme: string;
  onClose(): void;
  onDelete?(): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
}

interface Ply { fen: string; san: string; from: Key; to: Key; check: boolean; clock: number }

export const outcomeOf = (g: Pick<GameRecord, 'result' | 'userColor'>): 'win' | 'loss' | 'draw' =>
  g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === (g.userColor === 'w') ? 'win' : 'loss';

export const variantName = (g: Pick<GameRecord, 'lineWhite' | 'lineBlack'>) =>
  [g.lineWhite, g.lineBlack].filter((s) => s && s !== '?').join(' · ') || 'Sin nombre';

export function GameViewer({ game, boardTheme, onClose, onDelete, toast }: Props) {
  const cg = useRef<Api | null>(null);
  const startFen = game.startFen ?? START_FEN;
  const plies = useMemo<Ply[]>(() => {
    const c = new Chess(startFen);
    const out: Ply[] = [];
    for (let i = 0; i < game.sans.length; i++) {
      try {
        const m = c.move(game.sans[i]);
        out.push({ fen: c.fen(), san: m.san, from: m.from as Key, to: m.to as Key, check: c.inCheck(), clock: game.clocks[i] ?? 0 });
      } catch { break; }
    }
    return out;
  }, [game.id]);
  const [idx, setIdx] = useState(plies.length - 1);
  const [ready, setReady] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const go = (i: number) => setIdx(Math.max(-1, Math.min(plies.length - 1, i)));

  useEffect(() => {
    const api = cg.current;
    if (!api) return;
    const p = idx >= 0 ? plies[idx] : null;
    const fen = p ? p.fen : startFen;
    const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
    api.set({ fen, lastMove: p ? [p.from, p.to] : undefined, check: p?.check ? turn : false, turnColor: turn });
    listRef.current?.querySelector('.mv.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [idx, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { go(idx - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { go(idx + 1); e.preventDefault(); }
      else if (e.key === 'Home') go(-1);
      else if (e.key === 'End') go(plies.length - 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx]);

  const pgn = gameToPgn(game);
  const o = outcomeOf(game);
  const bot = botById(game.botId);
  const firstNo = Number(startFen.split(' ')[5]) || 1;
  const blackFirst = startFen.split(' ')[1] === 'b';
  const lichess = 'https://lichess.org/analysis/pgn/' + encodeURIComponent(
    plies.map((p, i) => { const ply = i + (blackFirst ? 1 : 0); return (ply % 2 === 0 ? `${firstNo + ply / 2}. ` : '') + p.san; }).join(' '),
  ).replace(/%20/g, '_');

  async function copy() {
    try { await navigator.clipboard.writeText(pgn); toast('PGN copiado.', 'good'); }
    catch { toast('No se pudo copiar. Usa «Descargar PGN».', 'bad'); }
  }
  function download() {
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${variantName(game).replace(/[^\w\- .·]+/g, '').slice(0, 60) || 'partida'}.pgn`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // rows of the move list
  const rows: { no: number; w?: number; b?: number }[] = [];
  plies.forEach((_, i) => {
    const ply = i + (blackFirst ? 1 : 0);
    const no = firstNo + Math.floor(ply / 2);
    if (ply % 2 === 0) rows.push({ no, w: i });
    else { if (!rows.length || rows[rows.length - 1].b !== undefined || rows[rows.length - 1].no !== no) rows.push({ no }); rows[rows.length - 1].b = i; }
  });
  const cls = (i?: number) => (i === undefined ? '' : `${i < game.linePlies ? 'line' : 'free'} ${i === idx ? 'current' : ''}`);
  const date = new Date(game.date);

  return (
    <div class="viewer-backdrop" role="dialog" aria-label="Partida guardada">
      <div class="viewer">
        <header class="viewer-head">
          <button type="button" class="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="x" size={22} /></button>
          <div class="viewer-title">
            <span class="eyebrow">{game.lineEvent || game.repName}</span>
            <h2>{variantName(game)}</h2>
            <span class="viewer-meta">
              {game.playerName} {game.userColor === 'w' ? '(blancas)' : '(negras)'} vs {game.botName} · {date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} · {game.timeControl.replace(/^(\d+)\+/, (_, s) => `${Number(s) / 60}+`)}
            </span>
          </div>
          <span class={`result-chip ${o}`}>{o === 'win' ? 'Victoria' : o === 'loss' ? 'Derrota' : 'Tablas'} · {game.result.replace('1/2-1/2', '½–½')}</span>
        </header>
        <div class="viewer-body">
          <div class="viewer-board">
            <div class="board-area">
              <Board theme={boardTheme} coords config={{ viewOnly: true, fen: startFen, orientation: game.userColor === 'w' ? 'white' : 'black' }} onReady={(api) => { cg.current = api; setReady(true); }} />
            </div>
            <div class="viewer-nav">
              <button type="button" class="nav-btn" aria-label="Inicio" onClick={() => go(-1)}>⏮</button>
              <button type="button" class="nav-btn" aria-label="Anterior" onClick={() => go(idx - 1)}>◀</button>
              <span class="nav-pos">{idx + 1}/{plies.length}{idx >= 0 && <em> · {fmtClock(plies[idx].clock)}</em>}</span>
              <button type="button" class="nav-btn" aria-label="Siguiente" onClick={() => go(idx + 1)}>▶</button>
              <button type="button" class="nav-btn" aria-label="Final" onClick={() => go(plies.length - 1)}>⏭</button>
            </div>
          </div>
          <aside class="viewer-side">
            <div class="viewer-facts">
              <div class="fact"><BotAvatar bot={bot} size={34} /><span><b>{game.botName}</b><em>{bot.styleLabel} · ≈{game.botElo}</em></span></div>
              <div class="fact"><span><b>{game.lineErrors}</b><em>errores en la línea</em></span></div>
              <div class="fact"><span><b>{Math.ceil(game.linePlies / 2)}</b><em>jugadas de línea</em></span></div>
              <div class="fact"><span><b>{game.termination || '—'}</b><em>final</em></span></div>
            </div>
            <div class="moves viewer-moves" ref={listRef}>
              {rows.map((r) => (
                <div class="move-row">
                  <span class="mno">{r.no}.</span>
                  <button type="button" class={`mv ${cls(r.w)}`} onClick={() => r.w !== undefined && go(r.w)}>{r.w !== undefined ? plies[r.w].san : '…'}</button>
                  <button type="button" class={`mv ${cls(r.b)}`} onClick={() => r.b !== undefined && go(r.b)}>{r.b !== undefined ? plies[r.b].san : ''}</button>
                </div>
              ))}
            </div>
            <div class="legend"><span class="lg lg-line" />Línea de repertorio<span class="lg lg-free" />Partida libre</div>
            <div class="viewer-actions">
              <a class="btn primary small" href={lichess} target="_blank" rel="noopener">Analizar en Lichess</a>
              <button type="button" class="btn ghost small" onClick={download}><Icon name="download" size={16} />PGN</button>
              <button type="button" class="btn ghost small" onClick={copy}><Icon name="copy" size={16} />Copiar</button>
              {onDelete && !confirmDel && <button type="button" class="btn ghost small" onClick={() => setConfirmDel(true)}><Icon name="trash" size={16} /></button>}
            </div>
            {onDelete && confirmDel && (
              <div class="confirm">
                <span>¿Borrar esta partida del registro?</span>
                <button type="button" class="btn danger small" onClick={onDelete}>Borrar</button>
                <button type="button" class="btn ghost small" onClick={() => setConfirmDel(false)}>No</button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
