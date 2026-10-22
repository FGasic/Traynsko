import { useEffect, useRef, useState } from 'preact/hooks';
import { TrainScreen, type AwardResult, type SaveResult } from './TrainScreen';
import { BotsScreen } from './BotsScreen';
import { SettingsScreen } from './SettingsScreen';
import { MyGamesScreen, LibraryScreen } from './WorldScreens';
import { Portal, MasterGate } from './Portal';
import { AdminRoom } from './AdminRoom';
import { AtlasScreen } from './Atlas';
import { Emblem } from './Emblem';
import { Icon, type IconName } from './parts';
import { api, ApiError, setPlayerName, setUserToken, type NewGame } from '../lib/api';
import { prefs, type KnownWorld, type Settings, type UserSession, type WorldSession } from '../lib/prefs';
import { startLichessLogin, takeLichessReturn } from '../lib/lichess';
import type { Medal } from '../../shared/atlas';
import { Engine } from '../lib/engine';
import { setSoundEnabled, primeSound } from '../lib/sound';
import type { Line, PublicWorld, RepMeta, Repertoire } from '../../shared/types';

type Tab = 'train' | 'games' | 'library' | 'atlas' | 'bots' | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'train', label: 'Entrenar', icon: 'train' },
  { id: 'games', label: 'Partidas', icon: 'archive' },
  { id: 'library', label: 'Biblioteca', icon: 'library' },
  { id: 'atlas', label: 'Atlas', icon: 'medal' },
  { id: 'bots', label: 'Bots', icon: 'bot' },
  { id: 'settings', label: 'Ajustes', icon: 'sliders' },
];
const OLD_TABS: Record<string, Tab> = { reps: 'library' };

interface Toast { id: number; text: string; kind: 'info' | 'good' | 'bad' }
type View = 'portal' | 'world' | 'room';

const initialUser = prefs.user();
setUserToken(initialUser?.token ?? null);
setPlayerName(prefs.session()?.name ?? null);
// Read Lichess's answer before anything renders, so the address bar is clean from the first paint.
const lichessReturn = takeLichessReturn();

export function App() {
  const [settings, setSettings] = useState<Settings>(prefs.settings);
  const [session, setSession] = useState<WorldSession | null>(prefs.session);
  const [known, setKnownState] = useState<KnownWorld[]>(prefs.known);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ run: () => void; label: string } | null>(null);
  const [user, setUserState] = useState<UserSession | null>(initialUser);
  const [signingIn, setSigningIn] = useState(lichessReturn?.kind === 'code');
  const [medals, setMedals] = useState<Medal[] | null>(null);
  const [medalErr, setMedalErr] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(prefs.adminToken);
  const [view, setView] = useState<View>(() => (prefs.session() ? 'world' : 'portal'));
  const [reps, setReps] = useState<Repertoire[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preselect, setPreselect] = useState<string | null>(lichessReturn && lichessReturn.kind !== 'invalid' && !prefs.session() ? lichessReturn.returnWorld ?? null : null);
  const [masterGate, setMasterGate] = useState(false);
  const [tab, setTab] = useState<Tab>(() => {
    const raw = location.hash.replace('#', '');
    const h = (OLD_TABS[raw] ?? raw) as Tab;
    return TABS.some((t) => t.id === h) ? h : 'train';
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [gamesKey, setGamesKey] = useState(0);
  const engineRef = useRef<Engine | null>(null);

  const toast = (text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600);
  };
  const engine = () => (engineRef.current ??= new Engine());

  useEffect(() => { setSoundEnabled(settings.sound); }, [settings.sound]);
  setPlayerName(session && !session.asMaster ? session.name : null);
  useEffect(() => {
    const prime = () => { primeSound(); window.removeEventListener('pointerdown', prime, true); };
    window.addEventListener('pointerdown', prime, true);
    return () => window.removeEventListener('pointerdown', prime, true);
  }, []);
  useEffect(() => { if (view === 'world') try { history.replaceState(null, '', '#' + tab); } catch { /* ignore */ } }, [tab, view]);

  /* ---------- Lichess account ---------- */
  function setUser(u: UserSession | null) {
    prefs.saveUser(u);
    setUserToken(u?.token ?? null);
    setUserState(u);
    setMedals(null);
    setMedalErr(null);
  }

  async function login(returnWorld?: string) {
    setSigningIn(true);
    try { await startLichessLogin(returnWorld); }
    catch (e: any) { setSigningIn(false); toast(e.message, 'bad'); }
  }

  function logout(message = 'Sesión de Lichess cerrada en este dispositivo.') {
    setUser(null);
    if (session) setGamesKey((k) => k + 1);
    toast(message);
  }

  useEffect(() => {
    const r = lichessReturn;
    if (!r) return;
    if (r.kind === 'invalid') { toast('No se pudo completar el acceso con Lichess. Vuelve a intentarlo.', 'bad'); return; }
    if (r.kind === 'cancelled') { toast('Acceso con Lichess cancelado.'); return; }
    api.lichessLogin(r.code, r.verifier, r.redirectUri).then(({ token, user: u }) => {
      setUser({ token, id: u.id, name: u.name });
      setGamesKey((k) => k + 1);
      toast(`Has entrado como ${u.name}.`, 'good');
    }).catch((e) => toast(e.message, 'bad')).finally(() => setSigningIn(false));
  }, []);

  const loadMedals = () => {
    if (!user) return;
    setMedalErr(null);
    api.medals().then(setMedals).catch((e) => { if (!handleAuth(e)) setMedalErr(e.message); });
  };
  useEffect(loadMedals, [user?.token]);
  const medalFps = new Set((medals ?? []).map((m) => m.fp));

  async function awardMedal(rep: RepMeta, line: Line): Promise<AwardResult> {
    if (!session) throw new Error('Entra a un repertorio.');
    try {
      const r = await api.awardMedal(session.token, { repId: rep.id, lineId: line.id, startPly: 0, errors: 0, hints: 0 });
      setMedals((prev) => [...(prev ?? []).filter((m) => m.fp !== r.medal.fp), r.medal]);
      return { isNew: r.isNew, count: r.medal.count };
    } catch (e) {
      handleAuth(e);
      throw e;
    }
  }

  /* ---------- world session ---------- */
  function setKnown(list: KnownWorld[]) { prefs.saveKnown(list); setKnownState(list); }
  // The stored list is the source of truth: callbacks from older renders must never write back a stale copy.
  /** Most recent first; one entry per repertoire. */
  function remember(entries: KnownWorld[]) {
    const ids = new Set(entries.map((e) => e.world.id));
    setKnown([...entries, ...prefs.known().filter((k) => !ids.has(k.world.id))]);
  }
  function forget(id: string) {
    setKnown(prefs.known().filter((k) => k.world.id !== id));
    if (session?.world.id === id) leaveWorld(null);
  }
  /** Leaving the open game (another repertoire, the master room) loses it: ask first. */
  function guard(run: () => void, label: string) {
    if (busy && view !== 'room') setPending({ run, label }); else run();
  }

  function leaveWorld(message: string | null, reselect?: string) {
    setBusy(false);
    prefs.saveSession(null);
    setSession(null);
    setReps([]);
    setLoaded(false);
    setNotice(message);
    setPreselect(reselect ?? null);
    setView('portal');
    try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  }

  /** Returns true when the error was a session problem that has been handled. */
  function handleAuth(e: unknown): boolean {
    if (!(e instanceof ApiError)) return false;
    if (e.status === 403 && e.code === 'access_blocked') {
      // this person was blocked from the open repertoire: out, and off the cover
      const wid = session?.world.id;
      if (wid) setKnown(prefs.known().filter((k) => k.world.id !== wid));
      leaveWorld(e.message);
      return true;
    }
    if (e.status !== 401) return false;
    if (e.code === 'account_required') { leaveWorld(e.message); return true; }
    if (e.code === 'account_expired' || e.code === 'no_account') { logout(e.message); return true; }
    if (e.code === 'admin_expired') { prefs.saveAdminToken(null); setAdminToken(null); setView(session ? 'world' : 'portal'); toast(e.message, 'bad'); return true; }
    const wid = session?.world.id;
    if (wid) {
      if (e.code === 'password_changed') setKnown(prefs.known().map((k) => (k.world.id === wid ? { ...k, stale: true } : k)));
      else setKnown(prefs.known().filter((k) => k.world.id !== wid));
    }
    leaveWorld(e.code === 'password_changed' ? `La clave de «${session?.world.name ?? 'este repertorio'}» cambió. Escribe la nueva para seguir.` : e.message, e.code === 'password_changed' ? wid : undefined);
    return true;
  }

  useEffect(() => {
    if (!session) return;
    let alive = true;
    setLoaded(false);
    api.content(session.token).then((r) => {
      if (!alive) return;
      setReps(r.reps);
      const s = { ...session, world: r.world };
      prefs.saveSession(s);
      // keep the cover's card up to date (name, emblem, counts)
      const list = prefs.known();
      if (list.some((k) => k.world.id === r.world.id)) setKnown(list.map((k) => (k.world.id === r.world.id ? { ...k, world: r.world } : k)));
      setLoaded(true);
      setTimeout(() => { try { engine(); } catch { /* reported when used */ } }, 300);
    }).catch((e) => { if (alive && !handleAuth(e)) { toast(e.message, 'bad'); setLoaded(true); } });
    return () => { alive = false; };
  }, [session?.token]);

  function enterWorld(token: string, world: PublicWorld, name: string, asMaster = false, more: KnownWorld[] = []) {
    const s: WorldSession = { token, world, name, asMaster };
    prefs.saveSession(s);
    remember([s, ...more]);
    setBusy(false);
    setSession(s);
    setNotice(null);
    setPreselect(null);
    setTab('train');
    setView('world');
  }

  /** From the cover or the Biblioteca: a repertoire this device already opened. */
  function openKnown(k: KnownWorld) {
    if (session && k.world.id === session.world.id) { setView('world'); return; }
    if (k.stale) { setNotice(`La clave de «${k.world.name}» cambió. Escribe la nueva para seguir.`); setPreselect(k.world.id); setView('portal'); return; }
    guard(() => enterWorld(k.token, k.world, k.name, k.asMaster), `Abrir «${k.world.name}»`);
  }

  /** The key alone opened one or more repertoires: enter the first, keep the rest on the cover. */
  function enteredWithKey(entries: { token: string; world: PublicWorld }[], name: string) {
    const [first, ...rest] = entries;
    guard(() => {
      enterWorld(first.token, first.world, name, false, rest.map((e) => ({ token: e.token, world: e.world, name })));
      if (rest.length) toast(`Esa clave abre ${entries.length} repertorios: todos quedan en tu portada.`, 'good');
    }, `Abrir «${first.world.name}»`);
  }

  /* ---------- settings ---------- */
  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => { const next = { ...prev, ...patch }; prefs.saveSettings(next); return next; });
  }
  const disabled = session ? settings.disabledReps[session.world.id] ?? [] : [];
  function toggleRep(id: string, on: boolean) {
    if (!session) return;
    const cur = new Set(disabled);
    if (on) cur.delete(id); else cur.add(id);
    updateSettings({ disabledReps: { ...settings.disabledReps, [session.world.id]: [...cur] } });
  }

  const playerName = user?.name ?? session?.name ?? '';

  async function saveGame(g: NewGame): Promise<SaveResult> {
    if (!session) return { ok: false, message: 'Entra a un repertorio para guardar.' };
    try {
      await api.saveGame(session.token, session.name, g);
      setGamesKey((k) => k + 1);
      return { ok: true, message: `Guardada en el registro de ${playerName}.` };
    } catch (e: any) {
      if (handleAuth(e)) return { ok: false, message: e.message };
      return { ok: false, message: e.message };
    }
  }

  /* ---------- master ---------- */
  function openMaster() {
    if (adminToken) guard(() => setView('room'), 'Abrir la Sala del maestro'); else setMasterGate(true);
  }

  const reps0 = reps;
  // With a repertoire open, the cover is drawn over it: the game below keeps its place and its clock.
  const inWorld = !!session && view !== 'room';
  const portal = (
    <Portal
      known={known} currentId={session?.world.id ?? null}
      notice={notice} preselect={preselect} hasMaster={!!adminToken} onMaster={openMaster}
      onOpen={openKnown} onForget={forget} onBack={session ? () => setView('world') : undefined}
      onEntered={enteredWithKey}
      onEnter={(t, w, n) => guard(() => enterWorld(t, w, n), `Abrir «${w.name}»`)}
      user={user} signingIn={signingIn} onLogin={login} onLogout={() => logout()}
    />
  );

  return (
    <div class={`app view-${inWorld ? 'world' : view}`}>
      {view === 'portal' && !session && portal}
      {view === 'portal' && session && <div class="portal-layer">{portal}</div>}

      {view === 'room' && adminToken && (
        <AdminRoom
          token={adminToken}
          boardTheme={settings.boardTheme}
          toast={toast}
          onExit={() => setView(session ? 'world' : 'portal')}
          onLogout={() => { prefs.saveAdminToken(null); setAdminToken(null); setView(session ? 'world' : 'portal'); toast('Sesión de maestro cerrada.'); }}
          onAuthFail={handleAuth}
          onPlay={(t, w) => enterWorld(t, w, user?.name || session?.name || prefs.lastName() || 'Maestro', true)}
        />
      )}

      {inWorld && session && (
        <>
          <header class="topbar" aria-hidden={view === 'portal'}>
            <button type="button" class="brand" onClick={() => setView('portal')} aria-label="Portada de Traynsko" title="Portada">
              <span class="wm-main small">TRAYNSKO</span>
            </button>
            <button type="button" class="world-badge" style={{ '--h': session.world.hue } as any} onClick={() => setTab('library')} title="Biblioteca">
              <Emblem emblem={session.world.emblem} hue={session.world.hue} size={22} />
              <span>{session.world.name}</span>
            </button>
            <nav class="tabs" aria-label="Secciones">
              {TABS.map((t) => (
                <button type="button" class={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} aria-label={t.label} title={t.label} onClick={() => setTab(t.id)}>
                  <Icon name={t.icon} size={20} />
                  <span>{t.label}</span>
                </button>
              ))}
            </nav>
          </header>
          <main class="content" aria-hidden={view === 'portal'}>
            <div class={`screen train-layer ${tab === 'train' ? '' : 'is-hidden'}`} aria-hidden={tab !== 'train'}>
              <TrainScreen
                key={session.world.id}
                active={tab === 'train' && view === 'world'}
                settings={settings}
                reps={reps0}
                disabled={disabled}
                linesLoaded={loaded}
                engine={engine}
                playerName={playerName}
                isMaster={!!session.asMaster}
                account={!!user}
                medalFps={medalFps}
                onAwardMedal={awardMedal}
                onSaveGame={saveGame}
                onUpdateSettings={updateSettings}
                onOpenMaster={openMaster}
                goTo={(t) => setTab(t as Tab)}
                onBusy={setBusy}
              />
            </div>
            {tab === 'library' && (
              <div class="screen page">
                <LibraryScreen
                  world={session.world} reps={reps0} disabled={disabled} onToggle={toggleRep}
                  isMaster={!!session.asMaster} onOpenMaster={openMaster}
                  known={known} onOpen={openKnown}
                  onEnter={(t, w, n) => guard(() => enterWorld(t, w, n), `Abrir «${w.name}»`)}
                  user={user} signingIn={signingIn} onLogin={login}
                />
              </div>
            )}
            {tab === 'atlas' && (
              <div class="screen page">
                <AtlasScreen reps={reps0} user={user} medals={medals} error={medalErr} signingIn={signingIn} onLogin={() => login()} onRetry={loadMedals} />
              </div>
            )}
            {tab === 'bots' && <div class="screen page"><BotsScreen settings={settings} onUpdate={updateSettings} /></div>}
            {tab === 'games' && (
              <div class="screen page">
                <MyGamesScreen token={session.token} player={playerName} boardTheme={settings.boardTheme} refreshKey={gamesKey} toast={toast} onAuthError={handleAuth} />
              </div>
            )}
            {tab === 'settings' && (
              <div class="screen page">
                <SettingsScreen
                  settings={settings}
                  onUpdate={updateSettings}
                  world={session.world}
                  name={session.name}
                  asMaster={!!session.asMaster}
                  token={session.token}
                  user={user}
                  signingIn={signingIn}
                  onLogin={() => login()}
                  onLogout={() => logout()}
                  onLogoutAll={async () => { try { await api.logoutAll(); logout('Sesión cerrada en todos tus dispositivos.'); } catch (e: any) { if (!handleAuth(e)) toast(e.message, 'bad'); } }}
                  onDeleteAccount={async () => {
                    try { const r = await api.deleteAccount(); logout(`Cuenta borrada, con ${r.games} ${r.games === 1 ? 'partida' : 'partidas'} y tus emblemas.`); }
                    catch (e: any) { if (!handleAuth(e)) toast(e.message, 'bad'); }
                  }}
                  onClaimed={(n) => { setGamesKey((k) => k + 1); toast(`${n} ${n === 1 ? 'partida pasó' : 'partidas pasaron'} a tu cuenta.`, 'good'); }}
                  onAuthError={handleAuth}
                  onRename={(n) => {
                    const s = { ...session, name: n };
                    prefs.saveSession(s); prefs.saveLastName(n); setSession(s);
                    setKnown(prefs.known().map((k) => (k.world.id === s.world.id ? { ...k, name: n } : k)));
                    toast('Nombre guardado.', 'good');
                  }}
                  onLeave={() => setView('portal')}
                  onMaster={openMaster}
                />
              </div>
            )}
          </main>
        </>
      )}

      {masterGate && (
        <MasterGate
          onClose={() => setMasterGate(false)}
          onOk={(t) => { prefs.saveAdminToken(t); setAdminToken(t); setMasterGate(false); guard(() => setView('room'), 'Abrir la Sala del maestro'); }}
        />
      )}

      {pending && (
        <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setPending(null)}>
          <div class="sheet confirm-sheet" role="alertdialog" aria-label="Partida en curso">
            <div class="gate-body">
              <span class="eyebrow">Partida en curso</span>
              <h2>¿Dejar la partida?</h2>
              <p class="help">La partida que estás jugando, o la que aún no guardaste, se perderá.</p>
            </div>
            <div class="sheet-foot">
              <button type="button" class="btn ghost" onClick={() => { setPending(null); setView('world'); setTab('train'); }}>Volver a la partida</button>
              <button type="button" class="btn primary" onClick={() => { const r = pending.run; setPending(null); r(); }}>{pending.label}</button>
            </div>
          </div>
        </div>
      )}

      <div class="toasts" aria-live="polite">
        {toasts.map((t) => <div class={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
