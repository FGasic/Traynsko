import { useEffect, useRef, useState } from 'preact/hooks';
import type { PublicWorld } from '../../shared/types';
import { Emblem } from './Emblem';
import { api, ApiError } from '../lib/api';
import { prefs, type KnownWorld, type UserSession } from '../lib/prefs';
import { Icon } from './parts';

interface Props {
  /** Repertoires this device has already opened (most recent first). */
  known: KnownWorld[];
  currentId: string | null;
  notice: string | null;
  /** A repertoire to ask the key for (its key changed, or we are back from Lichess). */
  preselect: string | null;
  onOpen(k: KnownWorld): void;
  onForget(id: string): void;
  /** Present when a repertoire is open underneath: back to it. */
  onBack?(): void;
  onEntered(entries: { token: string; world: PublicWorld }[], name: string): void;
  onEnter(token: string, world: PublicWorld, name: string): void;
  onMaster(): void;
  hasMaster: boolean;
  user: UserSession | null;
  signingIn: boolean;
  onLogin(returnWorld?: string): void;
  onLogout(): void;
}

/**
 * The cover. It shows only what this device has opened before; the full catalogue lives in the Biblioteca.
 * A new repertoire is opened with its key alone: the key says which one it is.
 */
export function Portal({ known, currentId, notice, preselect, onOpen, onForget, onBack, onEntered, onEnter, onMaster, hasMaster, user, signingIn, onLogin, onLogout }: Props) {
  const [setup, setSetup] = useState<{ db: boolean; master: boolean } | null>(null);
  const [chosen, setChosen] = useState<PublicWorld | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);

  useEffect(() => { api.health().then((h) => { if (!h.ok) setSetup(h); }).catch(() => { /* offline: the key form says so */ }); }, []);
  // Escape closes the cover when a repertoire is open underneath (sheets handle their own Escape first)
  useEffect(() => {
    if (!onBack) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.portal .sheet-backdrop')) onBack(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onBack]);
  // a repertoire whose key we need: from this device's list, or from the catalogue
  useEffect(() => {
    if (!preselect) return;
    const k = known.find((x) => x.world.id === preselect);
    if (k) { setChosen(k.world); return; }
    api.worlds().then((w) => { const p = w.find((x) => x.id === preselect); if (p) setChosen(p); }).catch(() => {});
  }, [preselect]);

  const has = known.length > 0;
  return (
    <div class="portal">
      <header class="portal-top">
        {onBack && <button type="button" class="btn ghost small portal-back" onClick={onBack} aria-label="Volver" title="Volver"><Icon name="back" size={16} /><span class="pb-label">Volver</span></button>}
        <div class="wordmark" aria-label="Traynsko">
          <span class="wm-main">TRAYNSKO</span>
          <span class="wm-sub">Entrenador de repertorio</span>
        </div>
        <button type="button" class="master-star" aria-label="Acceso del maestro" title="Acceso del maestro" onClick={onMaster}>★</button>
      </header>

      <section class="portal-hero">
        <span class="rule" aria-hidden="true" />
        <h1>{has ? 'Tus repertorios' : 'Entra a tu repertorio'}</h1>
        <p>{has ? 'Los que ya abriste en este dispositivo. Para otro, usa su clave.' : 'Escribe la clave que te dio tu entrenador.'}</p>
      </section>

      <AccountBar user={user} signingIn={signingIn} onLogin={() => onLogin()} onLogout={onLogout} />

      {notice && !chosen && <p class="notice gold portal-notice">{notice}</p>}
      {setup && (
        <div class="notice bad portal-notice">
          Configuración pendiente en el servidor: {!setup.db && 'falta conectar la base de datos'}{!setup.db && !setup.master && ' y '}{!setup.master && 'falta la clave maestra'}.
        </div>
      )}

      {has && (
        <ul class="world-grid">
          {known.map((k, i) => {
            const current = k.world.id === currentId;
            return (
              <li style={{ '--i': i } as any} class="known">
                <button type="button" class={`world-card ${current ? 'current' : ''}`} style={{ '--h': k.world.hue } as any} onClick={() => onOpen(k)}>
                  <Emblem emblem={k.world.emblem} hue={k.world.hue} size={76} />
                  <span class="wc-text">
                    <span class="wc-name">{k.world.name}</span>
                    {k.world.subtitle && <span class="wc-sub">{k.world.subtitle}</span>}
                    <span class="wc-meta">{k.world.lineCount} {k.world.lineCount === 1 ? 'línea' : 'líneas'} · {k.world.repCount} {k.world.repCount === 1 ? 'capítulo' : 'capítulos'}</span>
                    <span class="wc-enter">{current ? 'Continuar' : k.stale ? 'Clave nueva' : 'Entrar'}</span>
                  </span>
                </button>
                {forgetting === k.world.id ? (
                  <div class="wc-confirm" role="group" aria-label={`Quitar ${k.world.name}`}>
                    <span>¿Quitar de este dispositivo?</span>
                    <div class="wc-confirm-actions">
                      <button type="button" class="btn danger small" onClick={() => { setForgetting(null); onForget(k.world.id); }}>Quitar</button>
                      <button type="button" class="btn ghost small" onClick={() => setForgetting(null)}>No</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" class="wc-forget" aria-label={`Quitar ${k.world.name} de este dispositivo`} title="Quitar de este dispositivo" onClick={() => setForgetting(k.world.id)}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <KeyForm compact={has} user={user} onEntered={onEntered} />

      {hasMaster && !has && <p class="help portal-help">Como maestro, entra a cualquier repertorio desde la <button type="button" class="link" onClick={onMaster}>Sala del maestro</button>.</p>}

      <footer class="portal-foot">Stockfish 19 se ejecuta en tu dispositivo · Traynsko beta</footer>

      {chosen && (
        <EnterSheet
          world={chosen} message={preselect === chosen.id ? notice : null} onClose={() => setChosen(null)} onEnter={onEnter}
          user={user} signingIn={signingIn} onLogin={() => onLogin(chosen.id)}
        />
      )}
    </div>
  );
}

/** A key alone opens the repertoire (or repertoires) it belongs to. */
function KeyForm({ compact, user, onEntered }: { compact: boolean; user: UserSession | null; onEntered: Props['onEntered'] }) {
  const [password, setPassword] = useState('');
  const [name, setName] = useState(prefs.lastName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (!user && !name.trim()) { setErr('Escribe tu nombre o entra con Lichess.'); nameRef.current?.focus(); return; }
    if (!password.trim()) { setErr('Escribe la clave del repertorio.'); pwRef.current?.focus(); return; }
    setBusy(true); setErr(null);
    try {
      const entries = await api.enterWithKey(password, user ? undefined : name.trim());
      if (!user) prefs.saveLastName(name.trim());
      setPassword('');
      setBusy(false);
      onEntered(entries, user ? user.name : name.trim());
    } catch (e: any) {
      setErr(e instanceof ApiError && e.code === 'wrong_password' ? 'Esa clave no abre ningún repertorio. Revísala y vuelve a probar.' : e.message);   // blocked / account required come with their own message
      setBusy(false);
      pwRef.current?.select();
    }
  }

  return (
    <form class={`panel key-form ${compact ? 'compact' : ''}`} onSubmit={submit} aria-label="Entrar con una clave">
      {compact && <h2 class="section-title">Otro repertorio</h2>}
      {!user && (
        <>
          <label class="field-label" for="key-name">Tu nombre</label>
          <input id="key-name" ref={nameRef} class="input" value={name} maxLength={40} autoComplete="name" placeholder="Nombre y apellido" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </>
      )}
      <label class="field-label" for="key-pass">Clave del repertorio</label>
      <div class="pass-row">
        <input id="key-pass" ref={pwRef} class="input" type={show ? 'text' : 'password'} value={password} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellcheck={false} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        <button type="button" class="btn ghost small" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Ver'}</button>
      </div>
      <p class="help">{user ? `Jugarás como ${user.name}. La clave no distingue mayúsculas.` : 'No distingue mayúsculas. Sin cuenta, tus partidas se guardan con tu nombre: usa siempre el mismo.'}</p>
      {err && <p class="form-error" role="alert">{err}</p>}
      <div class="row-actions">
        <button type="submit" class="btn primary" disabled={busy}>{busy ? 'Comprobando…' : 'Entrar'}</button>
      </div>
    </form>
  );
}

/** Who is playing: a Lichess account, or nobody yet. */
function AccountBar({ user, signingIn, onLogin, onLogout }: { user: UserSession | null; signingIn: boolean; onLogin(): void; onLogout(): void }) {
  if (signingIn && !user) return <div class="account-bar"><span class="spinner small" /><span class="ab-text">Conectando con Lichess…</span></div>;
  if (user) {
    return (
      <div class="account-bar signed">
        <span class="ab-dot" aria-hidden="true" />
        <span class="ab-text">Jugando como <strong>{user.name}</strong></span>
        <button type="button" class="btn ghost small" onClick={onLogout}><Icon name="logout" size={16} />Salir</button>
      </div>
    );
  }
  return (
    <div class="account-bar">
      <span class="ab-text">Entra con Lichess y tus partidas y emblemas te siguen a cualquier dispositivo.</span>
      <button type="button" class="btn primary small" onClick={onLogin}><Icon name="login" size={16} />Entrar con Lichess</button>
    </div>
  );
}

export function EnterSheet({ world, message, onClose, onEnter, user, signingIn, onLogin }: {
  world: PublicWorld; message: string | null; onClose(): void; onEnter: Props['onEnter'];
  user: UserSession | null; signingIn: boolean; onLogin(): void;
}) {
  const [password, setPassword] = useState('');
  const [name, setName] = useState(prefs.lastName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { (user || name ? pwRef : nameRef).current?.focus(); }, []);

  async function submit(e: Event) {
    e.preventDefault();
    if (!user && !name.trim()) { setErr('Escribe tu nombre o entra con Lichess.'); nameRef.current?.focus(); return; }
    if (!password.trim()) { setErr('Escribe la clave del repertorio.'); pwRef.current?.focus(); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.enter(world.id, password, user ? undefined : name.trim());
      if (!user) prefs.saveLastName(name.trim());
      onEnter(r.token, r.world, user ? user.name : name.trim());
    } catch (e: any) {
      setErr(e.code === 'wrong_password' ? 'Esa clave no abre este repertorio. Revísala y vuelve a probar.' : e.message);
      setBusy(false);
      pwRef.current?.select();
    }
  }

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class="sheet gate" onSubmit={submit} aria-label={`Entrar a ${world.name}`}>
        <div class="gate-head" style={{ '--h': world.hue } as any}>
          <Emblem emblem={world.emblem} hue={world.hue} size={58} />
          <div>
            <span class="eyebrow">Entrar a</span>
            <h2>{world.name}</h2>
          </div>
        </div>
        <div class="gate-body">
          {message && <p class="notice gold">{message}</p>}
          {user ? (
            <div class="gate-account"><span class="ab-dot" aria-hidden="true" />Jugarás como <strong>{user.name}</strong><span class="tag">Lichess</span></div>
          ) : (
            <>
              <button type="button" class="btn ghost block" onClick={onLogin} disabled={signingIn}><Icon name="login" size={18} />{signingIn ? 'Conectando…' : 'Entrar con Lichess'}</button>
              <p class="help">Con tu cuenta ganas emblemas y tus partidas quedan a tu nombre, sin riesgo de confusiones.</p>
              <div class="or-rule"><span>o sin cuenta</span></div>
              <label class="field-label" for="gate-name">Tu nombre</label>
              <input id="gate-name" ref={nameRef} class="input" value={name} maxLength={40} autoComplete="name" placeholder="Nombre y apellido" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </>
          )}
          <label class="field-label" for="gate-pass">Clave del repertorio</label>
          <div class="pass-row">
            <input id="gate-pass" ref={pwRef} class="input" type={show ? 'text' : 'password'} value={password} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellcheck={false} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
            <button type="button" class="btn ghost small" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Ver'}</button>
          </div>
          <p class="help">{user ? 'No distingue mayúsculas.' : 'No distingue mayúsculas. Sin cuenta, tus partidas se guardan con tu nombre: usa siempre el mismo.'}</p>
          {err && <p class="form-error" role="alert">{err}</p>}
        </div>
        <div class="sheet-foot">
          <button type="button" class="btn ghost" onClick={onClose}>Volver</button>
          <button type="submit" class="btn primary" disabled={busy}>{busy ? 'Comprobando…' : 'Entrar'}</button>
        </div>
      </form>
    </div>
  );
}

export function MasterGate({ onClose, onOk }: { onClose(): void; onOk(token: string): void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  async function submit(e: Event) {
    e.preventDefault();
    if (!pw) return;
    setBusy(true); setErr(null);
    try { onOk(await api.admin.login(pw)); }
    catch (e: any) { setErr(e.message); setBusy(false); ref.current?.select(); }
  }
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class="sheet gate master" onSubmit={submit} aria-label="Clave maestra">
        <div class="gate-head">
          <span class="big-star" aria-hidden="true">★</span>
          <div>
            <span class="eyebrow">Acceso del maestro</span>
            <h2>Clave maestra</h2>
          </div>
        </div>
        <div class="gate-body">
          <label class="field-label" for="master-pass">Clave</label>
          <input id="master-pass" ref={ref} class="input" type="password" value={pw} autoComplete="current-password" onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
          {err && <p class="form-error" role="alert">{err}</p>}
        </div>
        <div class="sheet-foot">
          <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" class="btn primary" disabled={busy || !pw}>{busy ? 'Comprobando…' : 'Entrar a la Sala'}</button>
        </div>
      </form>
    </div>
  );
}
