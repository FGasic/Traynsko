import { useEffect, useRef, useState } from 'preact/hooks';
import { TrainScreen, type SaveResult } from './TrainScreen';
import { BotsScreen } from './BotsScreen';
import { SettingsScreen } from './SettingsScreen';
import { MyGamesScreen, RepertoireScreen } from './WorldScreens';
import { Portal, MasterGate } from './Portal';
import { AdminRoom } from './AdminRoom';
import { Emblem } from './Emblem';
import { Icon, type IconName } from './parts';
import { api, ApiError, type NewGame } from '../lib/api';
import { prefs, type Settings, type WorldSession } from '../lib/prefs';
import { Engine } from '../lib/engine';
import { setSoundEnabled, primeSound } from '../lib/sound';
import type { PublicWorld, Repertoire } from '../../shared/types';

type Tab = 'train' | 'reps' | 'bots' | 'games' | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'train', label: 'Entrenar', icon: 'train' },
  { id: 'reps', label: 'Repertorio', icon: 'book' },
  { id: 'bots', label: 'Bots', icon: 'bot' },
  { id: 'games', label: 'Partidas', icon: 'archive' },
  { id: 'settings', label: 'Ajustes', icon: 'sliders' },
];

interface Toast { id: number; text: string; kind: 'info' | 'good' | 'bad' }
type View = 'portal' | 'world' | 'room';

export function App() {
  const [settings, setSettings] = useState<Settings>(prefs.settings);
  const [session, setSession] = useState<WorldSession | null>(prefs.session);
  const [adminToken, setAdminToken] = useState<string | null>(prefs.adminToken);
  const [view, setView] = useState<View>(() => (prefs.session() ? 'world' : 'portal'));
  const [reps, setReps] = useState<Repertoire[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preselect, setPreselect] = useState<string | null>(null);
  const [masterGate, setMasterGate] = useState(false);
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.replace('#', '') as Tab;
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
  useEffect(() => {
    const prime = () => { primeSound(); window.removeEventListener('pointerdown', prime, true); };
    window.addEventListener('pointerdown', prime, true);
    return () => window.removeEventListener('pointerdown', prime, true);
  }, []);
  useEffect(() => { if (view === 'world') try { history.replaceState(null, '', '#' + tab); } catch { /* ignore */ } }, [tab, view]);

  /* ---------- world session ---------- */
  function leaveWorld(message: string | null, reselect?: string) {
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
    if (!(e instanceof ApiError) || e.status !== 401) return false;
    if (e.code === 'admin_expired') { prefs.saveAdminToken(null); setAdminToken(null); setView(session ? 'world' : 'portal'); toast(e.message, 'bad'); return true; }
    const wid = session?.world.id;
    leaveWorld(e.code === 'password_changed' ? `La clave de «${session?.world.name ?? 'este mundo'}» cambió. Escribe la nueva para seguir.` : e.message, e.code === 'password_changed' ? wid : undefined);
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
      setLoaded(true);
      setTimeout(() => { try { engine(); } catch { /* reported when used */ } }, 300);
    }).catch((e) => { if (alive && !handleAuth(e)) { toast(e.message, 'bad'); setLoaded(true); } });
    return () => { alive = false; };
  }, [session?.token]);

  function enterWorld(token: string, world: PublicWorld, name: string, asMaster = false) {
    const s: WorldSession = { token, world, name, asMaster };
    prefs.saveSession(s);
    setSession(s);
    setNotice(null);
    setPreselect(null);
    setTab('train');
    setView('world');
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

  async function saveGame(g: NewGame): Promise<SaveResult> {
    if (!session) return { ok: false, message: 'Entra a un mundo para guardar.' };
    try {
      await api.saveGame(session.token, session.name, g);
      setGamesKey((k) => k + 1);
      return { ok: true, message: `Guardada en el registro de ${session.name}.` };
    } catch (e: any) {
      if (handleAuth(e)) return { ok: false, message: e.message };
      return { ok: false, message: e.message };
    }
  }

  /* ---------- master ---------- */
  function openMaster() {
    if (adminToken) setView('room'); else setMasterGate(true);
  }

  const reps0 = reps;

  return (
    <div class={`app view-${view}`}>
      {view === 'portal' && (
        <Portal notice={notice} preselect={preselect} hasMaster={!!adminToken} onMaster={openMaster} onEnter={(t, w, n) => enterWorld(t, w, n)} />
      )}

      {view === 'room' && adminToken && (
        <AdminRoom
          token={adminToken}
          boardTheme={settings.boardTheme}
          toast={toast}
          onExit={() => setView(session ? 'world' : 'portal')}
          onLogout={() => { prefs.saveAdminToken(null); setAdminToken(null); setView(session ? 'world' : 'portal'); toast('Sesión de maestro cerrada.'); }}
          onAuthFail={handleAuth}
          onPlay={(t, w) => enterWorld(t, w, session?.name || prefs.lastName() || 'Maestro', true)}
        />
      )}

      {view === 'world' && session && (
        <>
          <header class="topbar">
            <button type="button" class="brand" onClick={() => setTab('train')} aria-label="Traynsko">
              <span class="wm-main small">TRAYNSKO</span>
            </button>
            <div class="world-badge" style={{ '--h': session.world.hue } as any}>
              <Emblem emblem={session.world.emblem} hue={session.world.hue} size={22} />
              <span>{session.world.name}</span>
            </div>
            <nav class="tabs" aria-label="Secciones">
              {TABS.map((t) => (
                <button type="button" class={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                  <Icon name={t.icon} size={20} />
                  <span>{t.label}</span>
                </button>
              ))}
            </nav>
          </header>
          <main class="content">
            <div class="screen" hidden={tab !== 'train'}>
              <TrainScreen
                settings={settings}
                reps={reps0}
                disabled={disabled}
                linesLoaded={loaded}
                engine={engine}
                playerName={session.name}
                isMaster={!!session.asMaster}
                onSaveGame={saveGame}
                onUpdateSettings={updateSettings}
                onOpenMaster={openMaster}
                goTo={(t) => setTab(t as Tab)}
              />
            </div>
            {tab === 'reps' && <div class="screen page"><RepertoireScreen reps={reps0} disabled={disabled} onToggle={toggleRep} isMaster={!!session.asMaster} onOpenMaster={openMaster} /></div>}
            {tab === 'bots' && <div class="screen page"><BotsScreen settings={settings} onUpdate={updateSettings} /></div>}
            {tab === 'games' && (
              <div class="screen page">
                <MyGamesScreen token={session.token} player={session.name} boardTheme={settings.boardTheme} refreshKey={gamesKey} toast={toast} onAuthError={handleAuth} />
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
                  onRename={(n) => { const s = { ...session, name: n }; prefs.saveSession(s); prefs.saveLastName(n); setSession(s); toast('Nombre guardado.', 'good'); }}
                  onLeave={() => leaveWorld(null)}
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
          onOk={(t) => { prefs.saveAdminToken(t); setAdminToken(t); setMasterGate(false); setView('room'); }}
        />
      )}

      <div class="toasts" aria-live="polite">
        {toasts.map((t) => <div class={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
