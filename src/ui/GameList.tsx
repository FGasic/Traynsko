import { useMemo, useState } from 'preact/hooks';
import type { GameSummary } from '../../shared/types';
import { outcomeOf, variantName } from './GameViewer';
import { PieceDot } from './parts';

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Hoy';
  if (same(d, y)) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
};

/** Saved games grouped by day, with a repertoire filter. Shared by the student log and the master room. */
export function GameList({ games, onOpen, showPlayer = false, empty }: { games: GameSummary[]; onOpen(id: string): void; showPlayer?: boolean; empty: preact.ComponentChildren }) {
  const [rep, setRep] = useState<string>('');
  const reps = useMemo(() => [...new Map(games.map((g) => [g.repId, g.repName])).entries()], [games]);
  const shown = rep ? games.filter((g) => g.repId === rep) : games;
  const groups = useMemo(() => {
    const m = new Map<string, GameSummary[]>();
    for (const g of shown) { const k = new Date(g.date).toDateString(); if (!m.has(k)) m.set(k, []); m.get(k)!.push(g); }
    return [...m.values()];
  }, [shown]);

  if (!games.length) return <div class="empty">{empty}</div>;
  return (
    <div class="game-list-wrap">
      {reps.length > 1 && (
        <div class="chips" role="radiogroup" aria-label="Filtrar por repertorio">
          <button type="button" role="radio" aria-checked={!rep} class={`chip ${!rep ? 'active' : ''}`} onClick={() => setRep('')}>Todos</button>
          {reps.map(([id, name]) => (
            <button type="button" role="radio" aria-checked={rep === id} class={`chip ${rep === id ? 'active' : ''}`} onClick={() => setRep(id)}>{name}</button>
          ))}
        </div>
      )}
      {groups.map((list) => (
        <section class="day">
          <h3 class="day-title">{dayLabel(list[0].date)}</h3>
          <ul class="game-list">
            {list.map((g) => {
              const o = outcomeOf(g);
              return (
                <li>
                  <button type="button" class="game" onClick={() => onOpen(g.id)}>
                    <span class={`res ${o}`}>{o === 'win' ? '1' : o === 'loss' ? '0' : '½'}</span>
                    <span class="game-id">
                      <span class="game-variant">{variantName(g)}</span>
                      <span class="game-meta">
                        {showPlayer && <b>{g.playerName} · </b>}
                        <PieceDot color={g.userColor} /> vs {g.botName} · {g.termination || g.result} · {Math.ceil(g.plies / 2)} jug.
                        {g.lineErrors > 0 ? <span class="err"> · {g.lineErrors} {g.lineErrors === 1 ? 'error' : 'errores'}</span> : <span class="clean"> · línea perfecta</span>}
                      </span>
                    </span>
                    <span class="game-time">{new Date(g.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function scoreLine(games: Pick<GameSummary, 'result' | 'userColor' | 'lineErrors'>[]) {
  const pts = games.reduce((s, g) => s + (outcomeOf(g) === 'win' ? 1 : outcomeOf(g) === 'draw' ? 0.5 : 0), 0);
  const perfect = games.filter((g) => g.lineErrors === 0).length;
  return { pts, perfect };
}

export const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n) || ''}½`);
