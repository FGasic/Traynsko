import { useMemo } from 'preact/hooks';
import { PIECE_SVG } from '../generated/pieces';
import { lineFingerprint, type Medal, type UserInfo } from '../../shared/atlas';
import { liveStreak, localDay, notaText, recordFor, scopeFingerprint, scopeLines, type NeteroRecord, type NeteroScope, type NeteroState } from '../../shared/netero';
import type { Line, Repertoire } from '../../shared/types';
import { fmtDuration, fmtSec } from '../lib/netero';
import { Icon, PieceDot } from './parts';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One Netero record, in a line: precision, pace, time, fails, date and device. */
export function RecordFacts({ rec }: { rec: NeteroRecord }) {
  return (
    <span class="nt-rec-facts">
      {pct(rec.precision)} · {fmtSec(rec.thinkMs / Math.max(1, rec.nodes))}/jug · {fmtDuration(rec.totalMs)} · {rec.fails} {rec.fails === 1 ? 'fail' : 'fails'} · {fmtDate(rec.date)} · {rec.device === 'movil' ? 'móvil' : 'PC'}
    </span>
  );
}

/** The Netero record of a scope as it is now (or the latest of a previous version). */
function NeteroRecordRow({ label, scope, fp, records }: { label: string; scope: NeteroScope; fp: string | null; records: NeteroRecord[] }) {
  const { current, previous } = fp ? recordFor(records, scope, fp) : { current: null, previous: null };
  return (
    <div class={`nt-atlas-row ${current ? '' : 'is-empty'}`}>
      <span class="nt-atlas-label">{label}</span>
      {current ? <><span class="nt-rec-nota">{notaText(current.nota)}</span><RecordFacts rec={current} /></> : <span class="nt-rec-none">Sin récord</span>}
      {!current && previous && <span class="nt-rec-prev">Versión anterior: {notaText(previous.nota)} ({fmtDate(previous.date)})</span>}
    </div>
  );
}

let seq = 0;
export type BadgeState = 'earned' | 'stale' | 'hidden';

/** A line's emblem: ivory shield for White chapters, midnight for Black; a dark silhouette while hidden. */
export function MedalBadge({ state, color, size = 56 }: { state: BadgeState; color: 'w' | 'b'; size?: number }) {
  const id = `md${++seq}`;
  const shield = 'M10 6 H90 V50 C90 80 72 99 50 110 C28 99 10 80 10 50 Z';
  const inner = 'M17 12.5 H83 V50 C83 75 67.5 91 50 100.5 C32.5 91 17 75 17 50 Z';
  if (state === 'hidden') {
    return (
      <svg class="medal-badge hidden" width={size} height={size * 1.16} viewBox="0 0 100 116" aria-hidden="true">
        <path d={shield} fill="#0b1424" stroke="rgba(220,183,94,.32)" stroke-width="3" stroke-dasharray="7 6" />
        <text x="50" y="72" text-anchor="middle" font-size="44" font-weight="800" font-family="var(--font-display)" fill="rgba(220,183,94,.35)">?</text>
      </svg>
    );
  }
  const white = color === 'w';
  return (
    <svg class={`medal-badge ${state}`} width={size} height={size * 1.16} viewBox="0 0 100 116" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={white ? '#f6eedb' : '#2b4672'} />
          <stop offset="1" stop-color={white ? '#c2ad84' : '#0a1222'} />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff1c1" />
          <stop offset=".45" stop-color="#e2bd66" />
          <stop offset=".55" stop-color="#a87f2e" />
          <stop offset="1" stop-color="#f0d68e" />
        </linearGradient>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="116">
          <image href={`data:image/svg+xml;base64,${PIECE_SVG.knight}`} x="21" y="22" width="58" height="58" />
        </mask>
      </defs>
      <path d={shield} fill={`url(#${id}f)`} />
      <rect x="0" y="0" width="100" height="116" fill={white ? '#1b2a44' : `url(#${id}g)`} mask={`url(#${id}m)`} />
      <path d={shield} fill="none" stroke={`url(#${id}g)`} stroke-width="5" />
      <path d={inner} fill="none" stroke={white ? '#8a6b2c' : '#e2bd66'} stroke-opacity=".45" stroke-width="1.2" />
    </svg>
  );
}

interface Props {
  reps: Repertoire[];
  user: UserInfo | null;
  medals: Medal[] | null;
  error: string | null;
  signingIn: boolean;
  onLogin(): void;
  onRetry(): void;
  worldId: string;
  worldName: string;
  /** Modo Netero: records and streak (null while loading) */
  netero: NeteroState | null;
  onOpenNetero(): void;
}

type Entry = { line: Line; index: number; state: BadgeState; medal?: Medal };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

export function AtlasScreen({ reps, user, medals, error, signingIn, onLogin, onRetry, worldId, worldName, netero, onOpenNetero }: Props) {
  // Netero records belong to the content as it is now: the fingerprint of the repertoire and of each chapter
  const neteroFps = useMemo(() => {
    const fp = (scope: { kind: 'world' | 'rep'; id: string }) => {
      const lines = scopeLines(reps, scope).map((x) => ({ color: x.rep.color, line: x.line }));
      return lines.length ? scopeFingerprint(lines) : null;
    };
    return { world: fp({ kind: 'world', id: worldId }), reps: new Map(reps.map((r) => [r.id, fp({ kind: 'rep', id: r.id })])) };
  }, [reps, worldId]);
  const streak = liveStreak(netero?.streak ?? null, localDay());
  const chapters = useMemo(() => {
    if (!medals) return [];
    const byFp = new Map(medals.map((m) => [m.fp, m]));
    return reps.map((rep) => {
      const entries: Entry[] = rep.lines.map((line, index) => {
        const medal = byFp.get(lineFingerprint(rep.color, line));
        if (medal) return { line, index, state: 'earned', medal };
        // same chapter, same name, different moves: the line was edited after the medal
        const named = !!(line.white.trim() || line.black.trim());
        const old = named ? medals.find((m) => (m.repId === rep.id || m.repName === rep.name) && m.white === line.white && m.black === line.black) : undefined;
        return old ? { line, index, state: 'stale', medal: old } : { line, index, state: 'hidden' };
      });
      return { rep, entries, earned: entries.filter((e) => e.state === 'earned').length };
    });
  }, [reps, medals]);

  const total = reps.reduce((n, r) => n + r.lines.length, 0);
  const earned = chapters.reduce((n, c) => n + c.earned, 0);
  const stale = chapters.reduce((n, c) => n + c.entries.filter((e) => e.state === 'stale').length, 0);

  return (
    <div class="page-inner">
      <header class="page-head">
        <div>
          <span class="eyebrow">{user ? `Colección de ${user.name}` : 'Tu colección'}</span>
          <h1>Atlas</h1>
          <p class="lede">Cada línea que completas sin errores desde la jugada 1 se convierte en un emblema. Las que aún no has conquistado siguen ocultas.</p>
        </div>
      </header>

      {!user && (
        <div class="empty atlas-gate">
          <MedalBadge state="hidden" color="w" size={48} />
          <h2>Los emblemas necesitan una cuenta</h2>
          <p>Entra con tu cuenta de Lichess para guardar tus emblemas y verlos en cualquier dispositivo. Traynsko solo recibe tu nombre de usuario.</p>
          <button type="button" class="btn primary" onClick={onLogin} disabled={signingIn}><Icon name="login" size={18} />{signingIn ? 'Conectando…' : 'Entrar con Lichess'}</button>
        </div>
      )}

      {user && error && <p class="notice bad">{error} <button type="button" class="btn ghost small" onClick={onRetry}>Reintentar</button></p>}
      {user && !medals && !error && <div class="loading"><div class="spinner" />Abriendo el Atlas…</div>}

      {user && medals && (
        <>
          <div class="tally">
            <div><b>{earned}<small> / {total}</small></b><span>emblemas</span></div>
            <div><b>{total ? Math.floor((earned / total) * 100) : 0}%</b><span>del Atlas</span></div>
            <div><b>{stale}</b><span>por revalidar</span></div>
          </div>
          {reps.length > 0 && (
            <section class="panel nt-atlas" aria-label="Récords Netero">
              <div class="panel-head">
                <h2 class="section-title">Récords Netero</h2>
                <span class="nt-streak" title="Días seguidos con al menos un Netero diario">Racha <b>{streak.cur}</b> {streak.cur === 1 ? 'día' : 'días'} · mejor {streak.best}</span>
              </div>
              {!netero && <div class="loading"><div class="spinner small" />Cargando récords…</div>}
              {netero && (
                <>
                  <NeteroRecordRow label="Repertorio completo" scope={{ kind: 'world', id: worldId, name: worldName }} fp={neteroFps.world} records={netero.records} />
                  {reps.length > 1 && reps.map((rep) => (
                    <NeteroRecordRow label={rep.name} scope={{ kind: 'rep', id: rep.id, name: rep.name }} fp={neteroFps.reps.get(rep.id) ?? null} records={netero.records} />
                  ))}
                </>
              )}
              <div class="row-actions"><button type="button" class="btn ghost small" onClick={onOpenNetero}><Icon name="netero" size={16} />Ir a Modo Netero</button></div>
            </section>
          )}
          {reps.length === 0 && <div class="empty"><h2>Aún no hay capítulos</h2><p>Cuando haya líneas en este repertorio, aparecerán aquí como emblemas por conquistar.</p></div>}
          {chapters.map(({ rep, entries, earned: got }) => (
            <section class="atlas-chapter">
              <header class="atlas-head">
                <PieceDot color={rep.color} />
                <h2>{rep.name}</h2>
                <span class="atlas-count">{got} / {entries.length}</span>
              </header>
              <div class="atlas-bar" role="progressbar" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={got} aria-label={`${rep.name}: ${got} de ${entries.length}`}>
                <i style={{ width: `${entries.length ? (got / entries.length) * 100 : 0}%` }} />
              </div>
              <ul class="medal-grid">
                {entries.map((e) => <MedalTile entry={e} color={rep.color} />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function MedalTile({ entry, color }: { entry: Entry; color: 'w' | 'b' }) {
  const { line, state, medal } = entry;
  const moves = Math.ceil(line.uci.split(' ').length / 2);
  if (state === 'hidden') {
    return (
      <li class="medal-tile hidden">
        <MedalBadge state="hidden" color={color} size={44} />
        <div class="mt-text">
          <span class="mt-name">Línea {entry.index + 1}</span>
          <span class="mt-meta">{moves} jugadas · por descubrir</span>
        </div>
      </li>
    );
  }
  return (
    <li class={`medal-tile ${state}`} title={state === 'stale' ? 'La línea cambió desde que ganaste este emblema: complétala de nuevo sin errores.' : undefined}>
      <MedalBadge state={state} color={color} size={44} />
      <div class="mt-text">
        <span class="mt-name">{line.white.trim() || line.event || `Línea ${entry.index + 1}`}</span>
        {line.black.trim() && line.black !== '?' && <span class="mt-sub">{line.black}</span>}
        <span class="mt-meta">
          {state === 'stale'
            ? <em class="mt-stale">A revalidar</em>
            : <>{fmtDate(medal!.first)}{medal!.count > 1 && <> · <b>×{medal!.count}</b></>}</>}
        </span>
      </div>
    </li>
  );
}
