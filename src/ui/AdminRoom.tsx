import { useEffect, useRef, useState } from 'preact/hooks';
import type { AdminWorld, Emblem as EmblemName, GameRecord, GameSummary, Member, PlayerStats, PublicWorld } from '../../shared/types';
import { ACCOUNT_PREFIX } from '../../shared/atlas';
import { lichessProfile } from '../lib/lichess';
import { api } from '../lib/api';
import { parseRepertoire, lineName, type ParseReport } from '../lib/pgn';
import { Emblem, EMBLEMS, HUES } from './Emblem';
import { GameList, fmtPts } from './GameList';
import { GameViewer } from './GameViewer';
import { Icon, PieceDot, Segmented, Toggle } from './parts';

type Toast = (t: string, k?: 'info' | 'good' | 'bad') => void;

interface Props {
  token: string;
  boardTheme: string;
  toast: Toast;
  onExit(): void;
  onLogout(): void;
  onAuthFail(e: unknown): boolean;
  onPlay(token: string, world: PublicWorld): void;
}

export function AdminRoom(p: Props) {
  const [worlds, setWorlds] = useState<AdminWorld[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<'worlds' | 'users'>('worlds');
  const [person, setPerson] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);   // person whose games to show when opening a repertoire from a profile
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setErr(null);
    try { setWorlds(await api.admin.overview(p.token)); }
    catch (e: any) { if (!p.onAuthFail(e)) setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const guard = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) p.toast(ok, 'good'); await load(); return true; }
    catch (e: any) { if (!p.onAuthFail(e)) p.toast(e.message, 'bad'); return false; }
  };

  const world = worlds?.find((w) => w.id === sel) ?? null;
  const everyone = worlds ? people(worlds) : [];
  const who = person ? everyone.find((x) => x.id === person) ?? null : null;
  const back = sel ? () => { setSel(null); setFocus(null); } : who ? () => setPerson(null) : p.onExit;
  const backLabel = sel ? (who ? who.name : 'Todos los repertorios') : who ? 'Todos los usuarios' : 'Salir de la Sala';
  const setAccess = (w: { id: string; name: string }, id: string, name: string, allowed: boolean) =>
    guard(() => api.admin.setAccess(p.token, w.id, id, !allowed, name), allowed ? `${name} vuelve a tener acceso a «${w.name}».` : `${name} ya no puede entrar a «${w.name}».`);

  return (
    <div class="room">
      <header class="room-top">
        <button type="button" class="btn ghost small" onClick={back}>
          <span class="back">‹</span>{backLabel}
        </button>
        <div class="room-title"><span class="star">★</span><span>Sala del maestro</span></div>
        <button type="button" class="btn ghost small" onClick={p.onLogout}>Cerrar sesión</button>
      </header>

      <div class="page-inner">
        {err && <p class="notice bad">{err} <button type="button" class="btn ghost small" onClick={load}>Reintentar</button></p>}
        {!worlds && !err && <div class="loading"><div class="spinner" />Abriendo la Sala…</div>}

        {worlds && !world && !who && (
          <div class="segmented room-nav" role="tablist" aria-label="Sala del maestro">
            <button type="button" role="tab" aria-selected={view === 'worlds'} class={view === 'worlds' ? 'active' : ''} onClick={() => setView('worlds')}>Repertorios · {worlds.length}</button>
            <button type="button" role="tab" aria-selected={view === 'users'} class={view === 'users' ? 'active' : ''} onClick={() => setView('users')}>Usuarios · {everyone.length}</button>
          </div>
        )}

        {worlds && !world && !who && view === 'users' && <UsersList people={everyone} onOpen={setPerson} />}
        {worlds && !world && who && (
          <Profile person={who} onAccess={setAccess} onGames={(w) => { setFocus(who.id); setSel(w.id); }} />
        )}

        {worlds && !world && !who && view === 'worlds' && (
          <>
            <header class="page-head">
              <div>
                <span class="eyebrow">Tus repertorios</span>
                <h1>Repertorios</h1>
                <p class="lede">Crea un repertorio, dale una clave y entrégala. Para dejar fuera a una persona no hace falta cambiar la clave: bloquéala en Usuarios.</p>
              </div>
              <button type="button" class="btn primary" onClick={() => setCreating(true)}>+ Nuevo repertorio</button>
            </header>
            {worlds.length === 0 && (
              <div class="empty"><h2>Todavía no hay repertorios</h2><p>Crea el primero: por ejemplo «Benko» o «Mesa 1», con la clave que darás a tus alumnos.</p></div>
            )}
            <ul class="admin-worlds">
              {worlds.map((w, i) => (
                <li class={`aw ${w.active ? '' : 'hidden-world'}`}>
                  <button type="button" class="aw-main" onClick={() => setSel(w.id)}>
                    <Emblem emblem={w.emblem} hue={w.hue} size={48} />
                    <span class="aw-id">
                      <span class="aw-name">{w.name}{!w.active && <em class="tag">Cerrado</em>}{w.listed ? <em class="tag">Biblioteca</em> : <em class="tag">Privado</em>}{w.accountOnly && <em class="tag">Solo Lichess</em>}</span>
                      <span class="aw-meta">{w.lineCount} líneas · {peopleOf(w).length} {peopleOf(w).length === 1 ? 'persona' : 'personas'} · {w.gameCount} partidas</span>
                    </span>
                    <span class="aw-key"><span class="field-label">Clave</span><code>{w.password}</code></span>
                  </button>
                  <span class="aw-order">
                    <button type="button" class="icon-btn" aria-label="Subir" disabled={i === 0} onClick={() => guard(() => api.admin.moveWorld(p.token, w.id, 'up'))}>▲</button>
                    <button type="button" class="icon-btn" aria-label="Bajar" disabled={i === worlds.length - 1} onClick={() => guard(() => api.admin.moveWorld(p.token, w.id, 'down'))}>▼</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {world && <WorldEditor key={world.id} world={world} {...p} guard={guard} initialStudent={focus} onAccess={setAccess} onDeleted={() => { setSel(null); load(); }} />}
      </div>

      {creating && (
        <CreateWorld
          onClose={() => setCreating(false)}
          onCreate={async (w) => {
            try {
              const created = await api.admin.createWorld(p.token, w);
              setCreating(false);
              p.toast(`«${created.name}» creado.`, 'good');
              await load();
              setSel(created.id);
            } catch (e: any) { if (!p.onAuthFail(e)) p.toast(e.message, 'bad'); }
          }}
        />
      )}
    </div>
  );
}

/* ---------------- one world ---------------- */

function WorldEditor({ world, token, boardTheme, toast, guard, onPlay, onAuthFail, onDeleted, initialStudent, onAccess }: Props & {
  world: AdminWorld; guard(fn: () => Promise<unknown>, ok?: string): Promise<boolean>; onDeleted(): void;
  initialStudent: string | null; onAccess(w: AdminWorld, id: string, name: string, allowed: boolean): void;
}) {
  const [name, setName] = useState(world.name);
  const [subtitle, setSubtitle] = useState(world.subtitle);
  const [emblem, setEmblem] = useState<EmblemName>(world.emblem);
  const [hue, setHue] = useState(world.hue);
  const dirty = name !== world.name || subtitle !== world.subtitle || emblem !== world.emblem || hue !== world.hue;
  const [newPw, setNewPw] = useState<string | null>(null);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [student, setStudent] = useState<string | null>(initialStudent);
  const [open, setOpen] = useState<GameRecord | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const loadGames = () => api.admin.games(token, world.id).then(setGames).catch((e) => { if (!onAuthFail(e)) toast(e.message, 'bad'); });
  useEffect(() => { loadGames(); }, [world.id, world.gameCount]);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast('Clave copiada.', 'good'); } catch { toast('No se pudo copiar.', 'bad'); }
  }
  async function play() {
    try { const r = await api.admin.enter(token, world.id); onPlay(r.token, r.world); }
    catch (e: any) { if (!onAuthFail(e)) toast(e.message, 'bad'); }
  }

  const shownGames = games && student ? games.filter((g) => g.playerKey === student) : games;

  return (
    <div class="editor">
      <header class="editor-head" style={{ '--h': hue } as any}>
        <Emblem emblem={emblem} hue={hue} size={84} />
        <div class="editor-id">
          <span class="eyebrow">{!world.active ? 'Cerrado' : world.listed ? 'En la Biblioteca' : 'Privado'}{world.accountOnly ? ' · solo con Lichess' : ''}</span>
          <h1>{name || 'Sin nombre'}</h1>
          {subtitle && <p class="lede">{subtitle}</p>}
        </div>
        <button type="button" class="btn primary" onClick={play}>Jugar en este repertorio</button>
      </header>

      {/* Access */}
      <section class="panel">
        <h2 class="section-title">Acceso</h2>
        <div class="key-row">
          <span class="field-label">Clave actual</span>
          <code class="key">{world.password}</code>
          <button type="button" class="btn ghost small" onClick={() => copy(world.password)}><Icon name="copy" size={16} />Copiar</button>
          {newPw === null && <button type="button" class="btn ghost small" onClick={() => setNewPw('')}>Cambiar clave</button>}
        </div>
        {newPw !== null && (
          <form class="inline-form" onSubmit={async (e) => {
            e.preventDefault();
            if (newPw.trim().length < 4) { toast('La clave debe tener al menos 4 caracteres.', 'bad'); return; }
            if (await guard(() => api.admin.updateWorld(token, world.id, { password: newPw.trim() }), 'Clave cambiada. Quien entró con la anterior tendrá que escribir la nueva.')) setNewPw(null);
          }}>
            <input id="new-pass" class="input" value={newPw} placeholder="Nueva clave" autoComplete="off" autoCapitalize="off" onInput={(e) => setNewPw((e.target as HTMLInputElement).value)} autoFocus />
            <button type="submit" class="btn primary small">Guardar clave</button>
            <button type="button" class="btn ghost small" onClick={() => setNewPw(null)}>Cancelar</button>
          </form>
        )}
        <p class="help">Al cambiar la clave quedan fuera todos los que entraron con la anterior. Para dejar fuera a una sola persona, bloquéala abajo en «Personas».</p>
        <div class="toggle-row">
          <span class="tr-text"><b>Abierto</b><small>Se puede entrar con la clave. Apagado, nadie entra.</small></span>
          <Toggle id="world-active" checked={world.active} label="Abierto" onChange={(v) => guard(() => api.admin.updateWorld(token, world.id, { active: v }), v ? 'Repertorio abierto.' : 'Repertorio cerrado: nadie puede entrar.')} />
        </div>
        <div class="toggle-row">
          <span class="tr-text"><b>Visible en la Biblioteca</b><small>Lo ven todos los usuarios en su Biblioteca. Apágalo en los repertorios personales.</small></span>
          <Toggle id="world-listed" checked={world.listed} label="Visible en la Biblioteca" onChange={(v) => guard(() => api.admin.updateWorld(token, world.id, { listed: v }), v ? 'Ahora aparece en la Biblioteca.' : 'Repertorio privado: solo entra quien tiene la clave.')} />
        </div>
        <div class="toggle-row">
          <span class="tr-text"><b>Solo con cuenta de Lichess</b><small>Así un bloqueo es definitivo: nadie puede volver a entrar con otro nombre.</small></span>
          <Toggle id="world-account" checked={world.accountOnly} label="Solo con cuenta de Lichess" onChange={(v) => guard(() => api.admin.updateWorld(token, world.id, { accountOnly: v }), v ? 'Solo se entra con cuenta de Lichess.' : 'También se entra sin cuenta.')} />
        </div>
      </section>

      {/* Identity */}
      <section class="panel">
        <h2 class="section-title">Identidad</h2>
        <div class="two-col">
          <div>
            <label class="field-label" for="w-name">Nombre</label>
            <input id="w-name" class="input" value={name} maxLength={60} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div>
            <label class="field-label" for="w-sub">Descripción corta</label>
            <input id="w-sub" class="input" value={subtitle} maxLength={120} placeholder="Gambito Benko con negras" onInput={(e) => setSubtitle((e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <EmblemPicker emblem={emblem} hue={hue} onEmblem={setEmblem} onHue={setHue} />
        <div class="row-actions">
          <button type="button" class="btn primary" disabled={!dirty || !name.trim()} onClick={() => guard(() => api.admin.updateWorld(token, world.id, { name: name.trim(), subtitle: subtitle.trim(), emblem, hue }), 'Cambios guardados.')}>Guardar identidad</button>
          {dirty && <button type="button" class="btn ghost" onClick={() => { setName(world.name); setSubtitle(world.subtitle); setEmblem(world.emblem); setHue(world.hue); }}>Descartar</button>}
        </div>
      </section>

      {/* Repertoires */}
      <RepertoireAdmin world={world} token={token} guard={guard} toast={toast} />

      {/* People */}
      <section class="panel">
        <h2 class="section-title">Personas</h2>
        {peopleOf(world).length === 0 ? (
          <p class="help">Quien entre con la clave aparecerá aquí, con su acceso y sus partidas.</p>
        ) : (
          <div class="table-wrap">
            <table class="students">
              <thead><tr><th>Persona</th><th>Partidas</th><th>Puntos</th><th>Errores / partida</th><th>Última vez</th><th>Acceso</th></tr></thead>
              <tbody>
                {peopleOf(world).map((x) => (
                  <tr class={`${student === x.id ? 'sel' : ''} ${x.member?.blocked ? 'blocked' : ''}`} onClick={() => setStudent(student === x.id ? null : x.id)}>
                    <td><b>{x.name}</b>{x.kind === 'account' && <em class="tag">Lichess</em>}</td>
                    <td>{x.stats?.games ?? 0}</td>
                    <td>{x.stats ? <>{fmtPts(x.stats.points)} <em>({Math.round((x.stats.points / Math.max(1, x.stats.games)) * 100)}%)</em></> : '—'}</td>
                    <td>{x.stats ? (x.stats.lineErrors / Math.max(1, x.stats.games)).toFixed(1) : '—'}</td>
                    <td>{fmtDay(x.last)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Toggle id={`acc-${world.id}-${x.id}`} checked={!x.member?.blocked} label={`Acceso de ${x.name}`} onChange={(v) => onAccess(world, x.id, x.name, v)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!world.accountOnly && peopleOf(world).some((x) => x.kind === 'guest' && x.member?.blocked) && (
          <p class="help">Un invitado bloqueado podría volver a entrar con otro nombre si conoce la clave. Activa «Solo con cuenta de Lichess» para impedirlo.</p>
        )}
      </section>

      {/* Games */}
      <section class="panel">
        <div class="panel-head">
          <h2 class="section-title">{student ? `Partidas de ${games?.find((g) => g.playerKey === student)?.playerName ?? 'este alumno'}` : 'Partidas'}</h2>
          {student && <button type="button" class="btn ghost small" onClick={() => setStudent(null)}>Ver todas</button>}
        </div>
        {!games && <div class="loading"><div class="spinner" />Cargando…</div>}
        {shownGames && (
          <GameList games={shownGames} showPlayer onOpen={async (id) => { try { setOpen(await api.admin.game(token, id)); } catch (e: any) { toast(e.message, 'bad'); } }}
            empty={<p>Sin partidas guardadas todavía.</p>} />
        )}
      </section>

      {/* Danger */}
      <section class="panel danger-zone">
        <h2 class="section-title">Eliminar repertorio</h2>
        {!confirmDel ? (
          <div class="row-actions">
            <p class="help">Borra el repertorio, sus capítulos y sus {world.gameCount} partidas. No se puede deshacer.</p>
            <button type="button" class="btn ghost small danger-text" onClick={() => setConfirmDel(true)}>Eliminar «{world.name}»</button>
          </div>
        ) : (
          <div class="confirm">
            <span>¿Eliminar «{world.name}» y todo su contenido?</span>
            <button type="button" class="btn danger small" onClick={async () => { if (await guard(() => api.admin.deleteWorld(token, world.id), 'Repertorio eliminado.')) onDeleted(); }}>Eliminar definitivamente</button>
            <button type="button" class="btn ghost small" onClick={() => setConfirmDel(false)}>Cancelar</button>
          </div>
        )}
      </section>

      {open && (
        <GameViewer game={open} boardTheme={boardTheme} toast={toast} onClose={() => setOpen(null)}
          onDelete={async () => { if (await guard(() => api.admin.deleteGame(token, open.id), 'Partida borrada.')) { setOpen(null); loadGames(); } }} />
      )}
    </div>
  );
}

function EmblemPicker({ emblem, hue, onEmblem, onHue }: { emblem: EmblemName; hue: number; onEmblem(e: EmblemName): void; onHue(h: number): void }) {
  return (
    <div class="picker">
      <div>
        <span class="field-label">Emblema</span>
        <div class="emblem-row" role="radiogroup" aria-label="Emblema">
          {EMBLEMS.map((e) => (
            <button type="button" role="radio" aria-checked={emblem === e.id} aria-label={e.label} class={`emblem-opt ${emblem === e.id ? 'active' : ''}`} onClick={() => onEmblem(e.id)}>
              <Emblem emblem={e.id} hue={hue} size={36} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <span class="field-label">Color</span>
        <div class="hue-row" role="radiogroup" aria-label="Color">
          {HUES.map((h) => (
            <button type="button" role="radio" aria-checked={hue === h} aria-label={`Color ${h}`} class={`hue-opt ${hue === h ? 'active' : ''}`} style={{ background: `linear-gradient(hsl(${h} 46% 38%), hsl(${h} 55% 16%))` }} onClick={() => onHue(h)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateWorld({ onClose, onCreate }: { onClose(): void; onCreate(w: { name: string; subtitle: string; password: string; emblem: EmblemName; hue: number; listed: boolean; accountOnly: boolean }): void }) {
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [password, setPassword] = useState('');
  const [emblem, setEmblem] = useState<EmblemName>('knight');
  const [hue, setHue] = useState(HUES[0]);
  const [listed, setListed] = useState(false);
  const [accountOnly, setAccountOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && password.trim().length >= 4;
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class="sheet gate wide" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); await onCreate({ name: name.trim(), subtitle: subtitle.trim(), password: password.trim(), emblem, hue, listed, accountOnly }); setBusy(false); }}>
        <div class="gate-head" style={{ '--h': hue } as any}>
          <Emblem emblem={emblem} hue={hue} size={58} />
          <div><span class="eyebrow">Nuevo repertorio</span><h2>{name || 'Sin nombre'}</h2></div>
        </div>
        <div class="gate-body">
          <label class="field-label" for="c-name">Nombre</label>
          <input id="c-name" class="input" value={name} maxLength={60} placeholder="Catalana, Benko, Mesa 1…" autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <label class="field-label" for="c-sub">Descripción corta (opcional)</label>
          <input id="c-sub" class="input" value={subtitle} maxLength={120} placeholder="Gambito Benko con negras" onInput={(e) => setSubtitle((e.target as HTMLInputElement).value)} />
          <label class="field-label" for="c-pass">Clave de acceso</label>
          <input id="c-pass" class="input" value={password} maxLength={100} placeholder="Mínimo 4 caracteres" autoComplete="off" autoCapitalize="off" onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
          <EmblemPicker emblem={emblem} hue={hue} onEmblem={setEmblem} onHue={setHue} />
          <div class="toggle-row">
            <span class="tr-text"><b>Visible en la Biblioteca</b><small>Déjalo apagado si es el repertorio personal de un alumno.</small></span>
            <Toggle id="c-listed" checked={listed} label="Visible en la Biblioteca" onChange={setListed} />
          </div>
          <div class="toggle-row">
            <span class="tr-text"><b>Solo con cuenta de Lichess</b><small>Recomendado para repertorios de pago: el bloqueo por persona no se puede esquivar.</small></span>
            <Toggle id="c-account" checked={accountOnly} label="Solo con cuenta de Lichess" onChange={setAccountOnly} />
          </div>
        </div>
        <div class="sheet-foot">
          <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" class="btn primary" disabled={!ok || busy}>{busy ? 'Creando…' : 'Crear repertorio'}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- repertoires of a world ---------------- */

function RepertoireAdmin({ world, token, guard, toast }: { world: AdminWorld; token: string; guard(fn: () => Promise<unknown>, ok?: string): Promise<boolean>; toast: Toast }) {
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ name: string; color: 'w' | 'b' | ''; report: ParseReport } | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  function prepare(text: string, name: string) {
    const report = parseRepertoire(text);
    if (!report.lines.length) { toast(report.errors[0] ? `No se encontró ninguna línea válida. ${report.errors[0].reason}.` : 'El texto no contiene partidas PGN.', 'bad'); return; }
    setPaste(null);
    setDraft({ name, color: '', report });
  }
  const readFile = async (f: File) => prepare(await f.text(), f.name.replace(/\.(pgn|txt)$/i, ''));

  return (
    <section class={`panel ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer?.files?.[0]; if (f) readFile(f); }}>
      <div class="panel-head">
        <h2 class="section-title">Capítulos</h2>
        <div class="row-actions">
          <button type="button" class="btn primary small" onClick={() => file.current?.click()}><Icon name="upload" size={16} />Subir PGN</button>
          <button type="button" class="btn ghost small" onClick={() => setPaste('')}>Pegar texto</button>
          <input ref={file} id="rep-file" type="file" accept=".pgn,.txt,application/x-chess-pgn,application/vnd.chess-pgn,text/plain" hidden
            onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) readFile(f); (e.target as HTMLInputElement).value = ''; }} />
        </div>
      </div>

      {paste !== null && !draft && (
        <div class="subpanel">
          <label class="field-label" for="rep-paste">Contenido del PGN</label>
          <textarea id="rep-paste" class="textarea" rows={7} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} />
          <div class="row-actions">
            <button type="button" class="btn primary small" disabled={!paste.trim()} onClick={() => prepare(paste, 'Capítulo')}>Analizar</button>
            <button type="button" class="btn ghost small" onClick={() => setPaste(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {draft && (
        <div class="subpanel">
          <div class="import-head"><span class="eyebrow">Nuevo capítulo</span><span class="import-count">{draft.report.lines.length} líneas</span></div>
          <div class="two-col">
            <div>
              <label class="field-label" for="rep-name">Nombre</label>
              <input id="rep-name" class="input" value={draft.name} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} />
            </div>
            <div>
              <span class="field-label">El alumno juega con</span>
              <Segmented id="rep-color" value={draft.color as any} options={[{ value: 'w', label: 'Blancas' }, { value: 'b', label: 'Negras' }]} onChange={(v) => setDraft({ ...draft, color: v as 'w' | 'b' })} />
            </div>
          </div>
          {(draft.report.trimmedVariations > 0 || draft.report.errors.length > 0) && (
            <ul class="notes">
              {draft.report.trimmedVariations > 0 && <li>{draft.report.trimmedVariations} partidas tenían subvariantes: se usa solo la línea principal.</li>}
              {draft.report.errors.slice(0, 4).map((e) => <li class="bad">«{e.name}»: {e.reason}. No se importa.</li>)}
            </ul>
          )}
          <ol class="line-preview">
            {draft.report.lines.slice(0, 6).map((l) => <li><span class="lp-event">{l.event}</span><span class="lp-name">{lineName(l) || 'Sin nombre'}</span><span class="lp-len">{Math.ceil(l.uci.split(' ').length / 2)} jug.</span></li>)}
            {draft.report.lines.length > 6 && <li class="more">… y {draft.report.lines.length - 6} más</li>}
          </ol>
          <div class="row-actions">
            <button type="button" class="btn primary" disabled={!draft.color || !draft.name.trim() || busy} onClick={async () => {
              setBusy(true);
              const ok = await guard(() => api.admin.addRep(token, world.id, { name: draft.name.trim(), color: draft.color as 'w' | 'b', lines: draft.report.lines }), `«${draft.name.trim()}» añadido a ${world.name}.`);
              setBusy(false);
              if (ok) setDraft(null);
            }}>{busy ? 'Subiendo…' : `Añadir a ${world.name}`}</button>
            <button type="button" class="btn ghost" onClick={() => setDraft(null)}>Cancelar</button>
            {!draft.color && <span class="hint-text">Elige el color para continuar.</span>}
          </div>
        </div>
      )}

      {world.reps.length === 0 && !draft && <p class="help">Arrastra aquí un .pgn o pulsa «Subir PGN». Cada partida del archivo es una línea; su nombre sale de los campos White y Black.</p>}
      {world.reps.length > 0 && (
        <ul class="rep-list">
          {world.reps.map((r) => (
            <li class="rep">
              <div class="rep-main">
                <PieceDot color={r.color} />
                <div class="rep-id">
                  <span class="rep-name">{r.name}</span>
                  <span class="rep-meta">{r.color === 'w' ? 'Blancas' : 'Negras'} · {r.lineCount} líneas</span>
                </div>
                <button type="button" class="btn ghost small" onClick={() => guard(() => api.admin.updateRep(token, world.id, r.id, { color: r.color === 'w' ? 'b' : 'w' }), 'Color cambiado.')}>Cambiar a {r.color === 'w' ? 'negras' : 'blancas'}</button>
                <button type="button" class="icon-btn" aria-label="Eliminar capítulo" onClick={() => setConfirm(r.id)}><Icon name="trash" size={18} /></button>
              </div>
              {confirm === r.id && (
                <div class="confirm">
                  <span>¿Eliminar «{r.name}»? Las partidas guardadas se conservan.</span>
                  <button type="button" class="btn danger small" onClick={() => { setConfirm(null); guard(() => api.admin.deleteRep(token, world.id, r.id), 'Capítulo eliminado.'); }}>Eliminar</button>
                  <button type="button" class="btn ghost small" onClick={() => setConfirm(null)}>Cancelar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------- people: who entered which repertoire ---------------- */

type Stat = PlayerStats & { key: string };
interface Access { world: AdminWorld; member?: Member; stats?: Stat }
interface Person { id: string; kind: Member['kind']; name: string; first: string; last: string; access: Access[] }
interface WorldPerson { id: string; kind: Member['kind']; name: string; last: string; member?: Member; stats?: Stat }

const kindOf = (id: string): Member['kind'] => (id.startsWith(ACCOUNT_PREFIX) ? 'account' : 'guest');
const fmtDay = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—');
const later = (a: string, b: string) => (a > b ? a : b);

/** Everyone in one repertoire: who entered it (members) and who saved games there before entries were recorded. */
function peopleOf(w: AdminWorld): WorldPerson[] {
  const map = new Map<string, WorldPerson>();
  for (const m of w.members) map.set(m.id, { id: m.id, kind: m.kind, name: m.name, last: m.last, member: m });
  for (const st of w.players) {
    const x = map.get(st.key);
    if (x) { x.stats = st; x.last = later(x.last, st.last); }
    else map.set(st.key, { id: st.key, kind: kindOf(st.key), name: st.name, last: st.last, stats: st });
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
}

/** One entry per person across all repertoires (accounts by Lichess id, guests by name). */
function people(worlds: AdminWorld[]): Person[] {
  const map = new Map<string, Person>();
  for (const w of worlds) {
    for (const x of peopleOf(w)) {
      const first = x.member?.first ?? x.last;
      const p = map.get(x.id) ?? { id: x.id, kind: x.kind, name: x.name, first, last: x.last, access: [] };
      p.first = p.first < first ? p.first : first;
      if (x.last >= p.last) { p.last = x.last; p.name = x.name; }
      p.access.push({ world: w, member: x.member, stats: x.stats });
      map.set(x.id, p);
    }
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
}

function UsersList({ people: list, onOpen }: { people: Person[]; onOpen(id: string): void }) {
  const [q, setQ] = useState('');
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const shown = q.trim() ? list.filter((x) => norm(x.name).includes(norm(q.trim())) || x.access.some((a) => norm(a.world.name).includes(norm(q.trim())))) : list;
  const blocked = list.filter((x) => x.access.some((a) => a.member?.blocked)).length;
  return (
    <>
      <header class="page-head">
        <div>
          <span class="eyebrow">Quién entra a tus repertorios</span>
          <h1>Usuarios</h1>
          <p class="lede">Abre un perfil para ver sus repertorios y sus partidas, y bloquear o devolver el acceso a una persona sin cambiar la clave de nadie.</p>
        </div>
      </header>
      <div class="users-tools">
        <input id="user-search" class="input" type="search" value={q} placeholder="Buscar por nombre o repertorio" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <span class="hint-text">{q.trim() ? `${shown.length} de ${list.length}` : list.length} {list.length === 1 ? 'persona' : 'personas'}{blocked ? ` · ${blocked} con algún bloqueo` : ''}</span>
      </div>
      {list.length === 0 && <div class="empty"><h2>Todavía no hay usuarios</h2><p>Cuando alguien entre con la clave de un repertorio aparecerá aquí.</p></div>}
      {list.length > 0 && shown.length === 0 && <p class="help">Nadie coincide con «{q}».</p>}
      <ul class="people">
        {shown.map((x) => {
          const games = x.access.reduce((n, a) => n + (a.stats?.games ?? 0), 0);
          return (
            <li>
              <button type="button" class="person" onClick={() => onOpen(x.id)}>
                <span class="pr-id">
                  <span class="pr-name">{x.name}{x.kind === 'account' && <em class="tag">Lichess</em>}</span>
                  <span class="pr-meta">{games} {games === 1 ? 'partida' : 'partidas'} · última vez {fmtDay(x.last)}</span>
                </span>
                <span class="pr-access">
                  {x.access.map((a) => <span class={`acc-chip ${a.member?.blocked ? 'off' : ''}`} style={{ '--h': a.world.hue } as any} title={a.member?.blocked ? 'Bloqueado' : 'Con acceso'}>{a.member?.blocked ? <Icon name="lock" size={12} /> : <i aria-hidden="true" />}{a.world.name}</span>)}
                </span>
                <Icon name="chevron" size={18} />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Profile({ person: x, onAccess, onGames }: { person: Person; onAccess(w: AdminWorld, id: string, name: string, allowed: boolean): void; onGames(w: AdminWorld): void }) {
  const games = x.access.reduce((n, a) => n + (a.stats?.games ?? 0), 0);
  const pts = x.access.reduce((n, a) => n + (a.stats?.points ?? 0), 0);
  const errs = x.access.reduce((n, a) => n + (a.stats?.lineErrors ?? 0), 0);
  const lichessId = x.kind === 'account' ? x.id.slice(ACCOUNT_PREFIX.length) : null;
  return (
    <div class="editor profile">
      <header class="editor-head profile-head">
        <div class="editor-id">
          <span class="eyebrow">{x.kind === 'account' ? 'Cuenta de Lichess' : 'Invitado · entró con su nombre'}</span>
          <h1>{x.name}</h1>
          <p class="lede">Primera vez {fmtDay(x.first)} · última vez {fmtDay(x.last)}</p>
        </div>
        {lichessId && <a class="btn ghost" href={lichessProfile(lichessId)} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} />Perfil en Lichess</a>}
      </header>

      <div class="tally">
        <div><b>{games}</b><span>partidas</span></div>
        <div><b>{fmtPts(pts)}</b><span>puntos</span></div>
        <div><b>{(errs / Math.max(1, games)).toFixed(1)}</b><span>errores por partida</span></div>
      </div>

      <section class="panel">
        <h2 class="section-title">Repertorios</h2>
        <ul class="access-list">
          {x.access.map((a) => {
            const on = !a.member?.blocked;
            return (
              <li class={`access ${on ? '' : 'off'}`}>
                <Emblem emblem={a.world.emblem} hue={a.world.hue} size={40} />
                <div class="ac-id">
                  <span class="ac-name">{a.world.name}{!a.world.listed && <em class="tag">Privado</em>}{a.world.accountOnly && <em class="tag">Solo Lichess</em>}</span>
                  <span class="ac-meta">
                    {a.stats ? `${a.stats.games} ${a.stats.games === 1 ? 'partida' : 'partidas'} · ${Math.round((a.stats.points / Math.max(1, a.stats.games)) * 100)}% · ${(a.stats.lineErrors / Math.max(1, a.stats.games)).toFixed(1)} errores/partida` : 'Sin partidas guardadas'}
                    {on ? '' : ` · bloqueado el ${fmtDay(a.member?.blockedAt ?? '')}`}
                  </span>
                </div>
                <div class="ac-actions">
                  {a.stats && <button type="button" class="btn ghost small" onClick={() => onGames(a.world)}>Partidas</button>}
                  <span class={`ac-state ${on ? 'on' : 'off'}`}>{on ? 'Con acceso' : 'Bloqueado'}</span>
                  <Toggle id={`pacc-${a.world.id}`} checked={on} label={`Acceso a ${a.world.name}`} onChange={(v) => onAccess(a.world, x.id, x.name, v)} />
                </div>
              </li>
            );
          })}
        </ul>
        {x.kind === 'guest' && x.access.some((a) => a.member?.blocked && !a.world.accountOnly) && (
          <p class="notice gold">Al ser invitado, podría volver a entrar con otro nombre si conoce la clave. Para impedirlo, activa «Solo con cuenta de Lichess» en ese repertorio.</p>
        )}
        <p class="help">Bloquear no cambia la clave ni afecta a nadie más: esta persona queda fuera al instante y no puede volver a entrar. Sus partidas se conservan.</p>
      </section>
    </div>
  );
}
