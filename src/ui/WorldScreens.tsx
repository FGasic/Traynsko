import { useEffect, useState } from 'preact/hooks';
import type { GameRecord, GameSummary, Repertoire } from '../../shared/types';
import { GameList, fmtPts, scoreLine } from './GameList';
import { GameViewer } from './GameViewer';
import { Icon, PieceDot, Toggle } from './parts';
import { lineName } from '../lib/pgn';
import { api } from '../lib/api';
import { gamesToPgn } from '../lib/pgnOut';

/* ---------------- Partidas: the player's log ---------------- */

export function MyGamesScreen({ token, player, boardTheme, refreshKey, toast, onAuthError }: {
  token: string; player: string; boardTheme: string; refreshKey: number;
  toast(t: string, k?: 'info' | 'good' | 'bad'): void; onAuthError(e: unknown): boolean;
}) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<GameRecord | null>(null);

  const load = () => {
    setErr(null);
    api.myGames(token, player).then(setGames).catch((e) => { if (!onAuthError(e)) setErr(e.message); });
  };
  useEffect(load, [token, player, refreshKey]);

  async function openGame(id: string) {
    try { setOpen(await api.game(token, id)); } catch (e: any) { if (!onAuthError(e)) toast(e.message, 'bad'); }
  }
  async function downloadAll() {
    if (!games?.length) return;
    try {
      const full = await Promise.all(games.map((g) => api.game(token, g.id)));
      const blob = new Blob([gamesToPgn(full)], { type: 'application/x-chess-pgn' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `Traynsko - ${player}.pgn`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e: any) { toast(e.message, 'bad'); }
  }

  const s = games ? scoreLine(games) : null;
  return (
    <div class="page-inner">
      <header class="page-head">
        <div>
          <span class="eyebrow">Registro de {player}</span>
          <h1>Partidas</h1>
          <p class="lede">Cada partida que guardas queda aquí, en cualquier dispositivo donde entres con tu nombre. Ábrela para repasarla jugada a jugada.</p>
        </div>
        {games && games.length > 0 && <button type="button" class="btn ghost" onClick={downloadAll}><Icon name="download" size={18} />Descargar todo</button>}
      </header>
      {err && <p class="notice bad">{err} <button type="button" class="btn ghost small" onClick={load}>Reintentar</button></p>}
      {!games && !err && <div class="loading"><div class="spinner" />Cargando tu registro…</div>}
      {games && s && games.length > 0 && (
        <div class="tally">
          <div><b>{games.length}</b><span>partidas</span></div>
          <div><b>{fmtPts(s.pts)}</b><span>puntos</span></div>
          <div><b>{Math.round((s.perfect / games.length) * 100)}%</b><span>líneas sin error</span></div>
        </div>
      )}
      {games && (
        <GameList games={games} onOpen={openGame} empty={<><h2>Aún no hay partidas</h2><p>Al terminar una partida pulsa «Guardar» y aparecerá aquí.</p></>} />
      )}
      {open && (
        <GameViewer
          game={open}
          boardTheme={boardTheme}
          toast={toast}
          onClose={() => setOpen(null)}
          onDelete={async () => {
            try { await api.deleteMyGame(token, open.id, player); setOpen(null); toast('Partida borrada.'); load(); }
            catch (e: any) { toast(e.message, 'bad'); }
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Repertorio: what this world trains ---------------- */

export function RepertoireScreen({ reps, disabled, onToggle, isMaster, onOpenMaster }: {
  reps: Repertoire[]; disabled: string[]; onToggle(id: string, on: boolean): void; isMaster: boolean; onOpenMaster(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const active = reps.filter((r) => !disabled.includes(r.id));
  const lines = active.reduce((n, r) => n + r.lines.length, 0);
  return (
    <div class="page-inner">
      <header class="page-head">
        <div>
          <span class="eyebrow">Este mundo</span>
          <h1>Repertorio</h1>
          <p class="lede">Cada sesión elige al azar una línea de los repertorios activos. Desactiva los que no quieras repasar ahora.</p>
        </div>
        {isMaster && <button type="button" class="btn ghost" onClick={onOpenMaster}><span class="star">★</span>Gestionar en la Sala</button>}
      </header>
      {reps.length === 0 ? (
        <div class="empty"><h2>Aún no hay repertorios</h2><p>{isMaster ? 'Sube un PGN desde la Sala del maestro.' : 'Tu entrenador todavía no ha subido líneas a este mundo.'}</p></div>
      ) : (
        <>
          <p class="summary"><strong>{active.length}</strong> de {reps.length} activos · <strong>{lines}</strong> líneas en juego</p>
          <ul class="rep-list">
            {reps.map((r) => {
              const on = !disabled.includes(r.id);
              return (
                <li class={`rep ${on ? '' : 'off'}`}>
                  <div class="rep-main">
                    <Toggle id={`rep-${r.id}`} checked={on} label={`Entrenar ${r.name}`} onChange={(v) => onToggle(r.id, v)} />
                    <PieceDot color={r.color} />
                    <div class="rep-id">
                      <span class="rep-name">{r.name}</span>
                      <span class="rep-meta">{r.color === 'w' ? 'Blancas' : 'Negras'} · {r.lines.length} {r.lines.length === 1 ? 'línea' : 'líneas'}</span>
                    </div>
                    <button type="button" class="icon-btn" aria-label="Ver líneas" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <span class={`chev ${open === r.id ? 'open' : ''}`}><Icon name="chevron" size={18} /></span>
                    </button>
                  </div>
                  {open === r.id && (
                    <ol class="line-preview full">
                      {r.lines.map((l) => <li><span class="lp-event">{l.event}</span><span class="lp-name">{lineName(l) || 'Sin nombre'}</span><span class="lp-len">{Math.ceil(l.uci.split(' ').length / 2)} jug.</span></li>)}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
