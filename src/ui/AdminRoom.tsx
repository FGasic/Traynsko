import { useEffect, useRef, useState } from 'preact/hooks';
import type { AdminWorld, Emblem as EmblemName, GameRecord, GameSummary, PublicWorld } from '../../shared/types';
import { playerKey } from '../../shared/types';
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

  return (
    <div class="room">
      <header class="room-top">
        <button type="button" class="btn ghost small" onClick={sel ? () => setSel(null) : p.onExit}>
          <span class="back">‹</span>{sel ? 'Todos los repertorios' : 'Salir de la Sala'}
        </button>
        <div class="room-title"><span class="star">★</span><span>Sala del maestro</span></div>
        <button type="button" class="btn ghost small" onClick={p.onLogout}>Cerrar sesión</button>
      </header>

      <div class="page-inner">
        {err && <p class="notice bad">{err} <button type="button" class="btn ghost small" onClick={load}>Reintentar</button></p>}
        {!worlds && !err && <div class="loading"><div class="spinner" />Abriendo la Sala…</div>}

        {worlds && !world && (
          <>
            <header class="page-head">
              <div>
                <span class="eyebrow">Tus repertorios</span>
                <h1>Repertorios</h1>
                <p class="lede">Crea un repertorio por tema, dale una clave y repártela. Si cambias la clave, quien entró con la anterior queda fuera al instante.</p>
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
                      <span class="aw-name">{w.name}{!w.active && <em class="tag">Oculto</em>}</span>
                      <span class="aw-meta">{w.lineCount} líneas · {w.players.length} {w.players.length === 1 ? 'alumno' : 'alumnos'} · {w.gameCount} partidas</span>
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

        {world && <WorldEditor key={world.id} world={world} {...p} guard={guard} onDeleted={() => { setSel(null); load(); }} />}
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

function WorldEditor({ world, token, boardTheme, toast, guard, onPlay, onAuthFail, onDeleted }: Props & {
  world: AdminWorld; guard(fn: () => Promise<unknown>, ok?: string): Promise<boolean>; onDeleted(): void;
}) {
  const [name, setName] = useState(world.name);
  const [subtitle, setSubtitle] = useState(world.subtitle);
  const [emblem, setEmblem] = useState<EmblemName>(world.emblem);
  const [hue, setHue] = useState(world.hue);
  const dirty = name !== world.name || subtitle !== world.subtitle || emblem !== world.emblem || hue !== world.hue;
  const [newPw, setNewPw] = useState<string | null>(null);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [student, setStudent] = useState<string | null>(null);
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
          <span class="eyebrow">{world.active ? 'Visible en la portada' : 'Oculto en la portada'}</span>
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
        <p class="help">Al cambiar la clave, todos los que estén dentro con la anterior quedan fuera en su siguiente acción. Ideal para cerrar una semana de prueba.</p>
        <div class="toggle-row">
          <span>Visible en la portada</span>
          <Toggle id="world-active" checked={world.active} label="Visible en la portada" onChange={(v) => guard(() => api.admin.updateWorld(token, world.id, { active: v }), v ? 'Repertorio visible.' : 'Repertorio oculto: nadie puede entrar.')} />
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

      {/* Students */}
      <section class="panel">
        <h2 class="section-title">Alumnos</h2>
        {world.players.length === 0 ? (
          <p class="help">Cuando alguien guarde su primera partida aparecerá aquí.</p>
        ) : (
          <div class="table-wrap">
            <table class="students">
              <thead><tr><th>Alumno</th><th>Partidas</th><th>Puntos</th><th>Errores / partida</th><th>Última</th></tr></thead>
              <tbody>
                {world.players.map((pl) => {
                  const key = playerKey(pl.name);
                  return (
                    <tr class={student === key ? 'sel' : ''} onClick={() => setStudent(student === key ? null : key)}>
                      <td><b>{pl.name}</b></td>
                      <td>{pl.games}</td>
                      <td>{fmtPts(pl.points)} <em>({Math.round((pl.points / Math.max(1, pl.games)) * 100)}%)</em></td>
                      <td>{(pl.lineErrors / Math.max(1, pl.games)).toFixed(1)}</td>
                      <td>{new Date(pl.last).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

function CreateWorld({ onClose, onCreate }: { onClose(): void; onCreate(w: { name: string; subtitle: string; password: string; emblem: EmblemName; hue: number }): void }) {
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [password, setPassword] = useState('');
  const [emblem, setEmblem] = useState<EmblemName>('knight');
  const [hue, setHue] = useState(HUES[0]);
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && password.trim().length >= 4;
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class="sheet gate wide" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); await onCreate({ name: name.trim(), subtitle: subtitle.trim(), password: password.trim(), emblem, hue }); setBusy(false); }}>
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
