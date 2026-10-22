import { useState } from 'preact/hooks';
import { Icon, Segmented, Toggle } from './parts';
import { sound } from '../lib/sound';
import { TIME_PRESETS as PRESETS, type Settings, type UserSession } from '../lib/prefs';
import { api } from '../lib/api';
import { lichessProfile } from '../lib/lichess';
import type { PublicWorld } from '../../shared/types';
import { Emblem } from './Emblem';

const THEMES: { id: Settings['boardTheme']; label: string }[] = [
  { id: 'imperio', label: 'Imperio' },
  { id: 'nogal', label: 'Nogal' },
  { id: 'torneo', label: 'Torneo' },
  { id: 'pizarra', label: 'Pizarra' },
];

interface Props {
  settings: Settings;
  onUpdate(p: Partial<Settings>): void;
  world: PublicWorld;
  name: string;
  asMaster: boolean;
  token: string;
  user: UserSession | null;
  signingIn: boolean;
  onLogin(): void;
  onLogout(): void;
  onLogoutAll(): void;
  onDeleteAccount(): Promise<void>;
  onClaimed(games: number): void;
  onAuthError(e: unknown): boolean;
  onRename(name: string): void;
  onLeave(): void;
  onMaster(): void;
}

export function SettingsScreen(props: Props) {
  const { settings: s, onUpdate, world, name, asMaster, onRename, onLeave, onMaster, user } = props;
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
  const [nm, setNm] = useState(name);
  return (
    <div class="page-inner">
      <header class="page-head">
        <div>
          <span class="eyebrow">Este dispositivo</span>
          <h1>Ajustes</h1>
          <p class="lede">Los cambios se aplican a la próxima partida. Una partida en curso no se toca.</p>
        </div>
        <button type="button" class="master-star inline" aria-label="Acceso del maestro" title="Acceso del maestro" onClick={onMaster}>★</button>
      </header>

      <section class="panel settings world-panel" style={{ '--h': world.hue } as any}>
        <Emblem emblem={world.emblem} hue={world.hue} size={52} />
        <div class="wp-id">
          <span class="eyebrow">{asMaster ? 'Estás como maestro en' : 'Estás en'}</span>
          <span class="wp-name">{world.name}</span>
        </div>
        <button type="button" class="btn ghost" onClick={onLeave}>Cambiar de repertorio</button>
      </section>

      {user ? <AccountPanel {...props} user={user} /> : (
        <>
          <section class="panel settings account-cta">
            <h2 class="section-title">Cuenta</h2>
            <p class="help">Entra con tu cuenta de Lichess para ganar emblemas en el Atlas y tener tus partidas a tu nombre en cualquier dispositivo. Traynsko solo recibe tu nombre de usuario: nunca tu correo ni tu contraseña.</p>
            <div class="row-actions">
              <button type="button" class="btn primary" onClick={props.onLogin} disabled={props.signingIn}><Icon name="login" size={18} />{props.signingIn ? 'Conectando…' : 'Entrar con Lichess'}</button>
            </div>
          </section>
          <section class="panel settings">
            <h2 class="section-title">Tu nombre (sin cuenta)</h2>
            <form class="inline-form" onSubmit={(e) => { e.preventDefault(); if (nm.trim()) onRename(nm.trim()); }}>
              <input id="player-name" class="input" value={nm} maxLength={40} onInput={(e) => setNm((e.target as HTMLInputElement).value)} />
              <button type="submit" class="btn ghost small" disabled={!nm.trim() || nm.trim() === name}>Guardar</button>
            </form>
            <p class="help">Sin cuenta, tus partidas se guardan con este nombre. Si lo cambias, verás las partidas guardadas con el nombre nuevo.</p>
          </section>
        </>
      )}

      <section class="panel settings">
        <h2 class="section-title">Ritmo</h2>
        <div class="chips" role="radiogroup" aria-label="Ritmos rápidos">
          {PRESETS.map(([m, i]) => (
            <button type="button" role="radio" aria-checked={s.baseMin === m && s.incSec === i} class={`chip mono ${s.baseMin === m && s.incSec === i ? 'active' : ''}`} onClick={() => onUpdate({ baseMin: m, incSec: i })}>
              {m}+{i}
            </button>
          ))}
        </div>
        <div class="inline-fields">
          <label class="mini-field" for="base-min">Minutos<input id="base-min" class="input small num" type="number" inputMode="numeric" min={1} max={180} value={s.baseMin} onChange={(e) => onUpdate({ baseMin: num((e.target as HTMLInputElement).value, 1, 180) })} /></label>
          <label class="mini-field" for="inc-sec">Incremento (s)<input id="inc-sec" class="input small num" type="number" inputMode="numeric" min={0} max={60} value={s.incSec} onChange={(e) => onUpdate({ incSec: num((e.target as HTMLInputElement).value, 0, 60) })} /></label>
        </div>
        <p class="help">El reloj arranca con la primera jugada y sigue corriendo mientras corriges un error de la línea.</p>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Desde qué jugada empiezas</h2>
        <Segmented id="start-mode" value={s.startMode} options={[{ value: 'start', label: 'Desde el inicio' }, { value: 'fixed', label: 'Jugada fija' }, { value: 'random', label: 'Al azar' }]} onChange={(v) => onUpdate({ startMode: v })} />
        {s.startMode === 'fixed' && (
          <label class="mini-field" for="start-move">Empiezo en la jugada<input id="start-move" class="input small num" type="number" inputMode="numeric" min={1} max={80} value={s.startMove} onChange={(e) => onUpdate({ startMove: num((e.target as HTMLInputElement).value, 1, 80) })} /></label>
        )}
        {s.startMode === 'random' && (
          <label class="mini-field" for="random-max">Entre la jugada 1 y la<input id="random-max" class="input small num" type="number" inputMode="numeric" min={2} max={80} value={s.randomMax} onChange={(e) => onUpdate({ randomMax: num((e.target as HTMLInputElement).value, 2, 80) })} /></label>
        )}
        <p class="help">
          {s.startMode === 'start' ? 'El tablero aparece en la posición inicial y juegas la línea completa.' :
            'El tablero aparece ya en esa posición, con las jugadas anteriores en la lista.'}
        </p>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Tu color</h2>
        <Segmented id="color-mode" value={s.colorMode} options={[{ value: 'rep', label: 'El del repertorio' }, { value: 'opposite', label: 'El contrario' }]} onChange={(v) => onUpdate({ colorMode: v })} />
        <p class="help">
          {s.colorMode === 'rep' ? 'Juegas el lado de tu repertorio; el rival responde con la línea.' :
            'Juegas el otro lado: repites las respuestas de la línea mientras tu repertorio juega solo. Así practicas contra tus propias jugadas. Con este color no se ganan emblemas.'}
        </p>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Tablero</h2>
        <div class="swatches" role="radiogroup" aria-label="Colores del tablero">
          {THEMES.map((t) => (
            <button type="button" role="radio" aria-checked={s.boardTheme === t.id} class={`swatch theme-${t.id} ${s.boardTheme === t.id ? 'active' : ''}`} onClick={() => onUpdate({ boardTheme: t.id })}>
              <span class="swatch-board" aria-hidden="true"><i /><i /><i /><i /></span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div class="toggle-row"><span>Coordenadas</span><Toggle id="coords" checked={s.coords} label="Coordenadas" onChange={(v) => onUpdate({ coords: v })} /></div>
        <div class="toggle-row">
          <span>Sonido</span>
          <span class="toggle-side">
            {s.sound && <button type="button" class="btn ghost small" onClick={() => sound.preview()}>Escuchar</button>}
            <Toggle id="sound" checked={s.sound} label="Sonido" onChange={(v) => onUpdate({ sound: v })} />
          </span>
        </div>
      </section>

      <p class="help credits">Motor: Stockfish 19 lite (GPLv3), en tu dispositivo. Tablero: chessground (GPLv3). Sonidos: Kenney (CC0).</p>
    </div>
  );
}

function AccountPanel(p: Props & { user: UserSession }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [old, setOld] = useState(p.name !== p.user.name ? p.name : '');
  const [preview, setPreview] = useState<{ name: string; games: number; claimed: 'you' | 'other' | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  async function look(e: Event) {
    e.preventDefault();
    const n = old.trim();
    if (!n) return;
    setBusy(true); setMsg(null); setPreview(null);
    try { setPreview({ name: n, ...(await api.claimPreview(p.token, n)) }); }
    catch (err: any) { if (!p.onAuthError(err)) setMsg({ text: err.message, bad: true }); }
    setBusy(false);
  }
  async function claim() {
    if (!preview) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.claim(p.token, preview.name);
      setPreview(null); setOld('');
      setMsg({ text: r.games === 1 ? `Listo: la partida de «${preview.name}» ya está en tu cuenta.` : `Listo: las ${r.games} partidas de «${preview.name}» ya están en tu cuenta.` });
      p.onClaimed(r.games);
    } catch (err: any) { if (!p.onAuthError(err)) setMsg({ text: err.message, bad: true }); }
    setBusy(false);
  }

  return (
    <>
      <section class="panel settings account-panel">
        <h2 class="section-title">Tu cuenta</h2>
        <div class="account-id">
          <span class="ab-dot" aria-hidden="true" />
          <div class="ai-text">
            <span class="ai-name">{p.user.name}</span>
            <span class="ai-meta">Cuenta de Lichess</span>
          </div>
          <a class="btn ghost small" href={lichessProfile(p.user.name)} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} />Perfil</a>
        </div>
        <p class="help">Traynsko solo guarda tu nombre de usuario de Lichess, las partidas que decides guardar y tus emblemas. No tiene acceso a tu correo, tu contraseña ni tu cuenta de Lichess.</p>
        <div class="row-actions">
          <button type="button" class="btn ghost small" onClick={p.onLogout}><Icon name="logout" size={16} />Cerrar sesión</button>
          <button type="button" class="btn ghost small" onClick={p.onLogoutAll}>Cerrar sesión en todos los dispositivos</button>
        </div>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Partidas de antes</h2>
        <p class="help">Si jugaste en «{p.world.name}» sin cuenta, escribe el nombre que usabas para pasar esas partidas a tu cuenta.</p>
        <form class="inline-form" onSubmit={look}>
          <input id="claim-name" class="input" value={old} maxLength={40} placeholder="Nombre que usabas" onInput={(e) => { setOld((e.target as HTMLInputElement).value); setPreview(null); }} />
          <button type="submit" class="btn ghost small" disabled={busy || !old.trim()}>Buscar</button>
        </form>
        {preview && (preview.claimed === 'other'
          ? <p class="save-msg bad">Las partidas de «{preview.name}» ya pertenecen a otra cuenta.</p>
          : preview.games === 0
            ? <p class="save-msg">No hay partidas guardadas con «{preview.name}» en este repertorio.</p>
            : (
              <div class="confirm">
                <span>{preview.games} {preview.games === 1 ? 'partida' : 'partidas'} con «{preview.name}».</span>
                <button type="button" class="btn primary small" onClick={claim} disabled={busy}>{preview.games === 1 ? 'Pasarla a mi cuenta' : 'Pasarlas a mi cuenta'}</button>
              </div>
            ))}
        {msg && <p class={`save-msg ${msg.bad ? 'bad' : 'good'}`}>{msg.text}</p>}
      </section>

      <section class="panel settings danger-zone">
        <h2 class="section-title">Borrar mi cuenta</h2>
        <p class="help">Borra tus emblemas y todas las partidas guardadas con tu cuenta, en todos los repertorios. No se puede deshacer.</p>
        {!confirmDelete
          ? <div class="row-actions"><button type="button" class="btn ghost small danger-text" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} />Borrar mi cuenta</button></div>
          : (
            <div class="confirm">
              <span>¿Borrar la cuenta de {p.user.name} y todos sus datos?</span>
              <button type="button" class="btn danger small" disabled={deleting} onClick={async () => { setDeleting(true); await p.onDeleteAccount(); setDeleting(false); setConfirmDelete(false); }}>{deleting ? 'Borrando…' : 'Sí, borrar'}</button>
              <button type="button" class="btn ghost small" onClick={() => setConfirmDelete(false)}>Cancelar</button>
            </div>
          )}
      </section>
    </>
  );
}
