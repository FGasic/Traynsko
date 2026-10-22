// Per-device storage: training preferences, the open world session and the master session.
import { BOTS } from './bots';
import type { PublicWorld } from '../../shared/types';

export interface Settings {
  v: number;
  baseMin: number;
  incSec: number;
  startMode: 'start' | 'fixed' | 'random';
  startMove: number;
  randomMax: number;
  elo: number;
  botMoveSec: number;
  enabledBots: string[];
  boardTheme: 'nogal' | 'torneo' | 'pizarra' | 'imperio';
  sound: boolean;
  coords: boolean;
  /** Play the repertoire's side, or the other one (the user plays the line's replies). */
  colorMode: 'rep' | 'opposite';
  lastLineId?: string;
  /** repertoire ids the player switched off, per world */
  disabledReps: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  v: 2,
  baseMin: 10,
  incSec: 5,
  startMode: 'start',
  startMove: 10,
  randomMax: 12,
  elo: 2300,
  botMoveSec: 3,
  enabledBots: BOTS.filter((b) => b.id !== 'maquina').map((b) => b.id),
  boardTheme: 'imperio',
  sound: true,
  coords: true,
  colorMode: 'rep',
  disabledReps: {},
};

/** Quick time controls (minutes + increment in seconds). */
export const TIME_PRESETS: [number, number][] = [[3, 2], [5, 3], [10, 5], [15, 10], [25, 10], [45, 15], [90, 30]];

export interface WorldSession { token: string; world: PublicWorld; name: string; asMaster?: boolean }
/** A repertoire this device has entered before. `stale`: its key changed, it needs the new one. */
export interface KnownWorld extends WorldSession { stale?: boolean }
/** Lichess account on this device (the token is signed by the Traynsko server, not a Lichess token). */
export interface UserSession { token: string; id: string; name: string }

const P = 'traynsko:';
function get<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(P + k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function put(k: string, v: unknown) {
  try { if (v === null || v === undefined) localStorage.removeItem(P + k); else localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* private mode */ }
}

export const prefs = {
  settings: (): Settings => {
    const stored = get<Partial<Settings> & { revealBot?: unknown }>('settings', {});
    delete stored.revealBot;
    // v2: the Imperio board becomes the default for everyone
    if (!stored.v || stored.v < 2) { stored.boardTheme = 'imperio'; stored.v = 2; }
    return { ...DEFAULT_SETTINGS, ...stored };
  },
  saveSettings: (s: Settings) => put('settings', s),
  session: () => get<WorldSession | null>('session', null),
  saveSession: (s: WorldSession | null) => put('session', s),
  /** Repertoires entered on this device, most recent first (shown on the cover). */
  known: (): KnownWorld[] => {
    const list = get<KnownWorld[] | null>('known', null);
    if (list) return list;
    const cur = get<WorldSession | null>('session', null);   // before the cover existed: only the open one
    return cur ? [cur] : [];
  },
  saveKnown: (list: KnownWorld[]) => put('known', list),
  adminToken: () => get<string | null>('admin', null),
  saveAdminToken: (t: string | null) => put('admin', t),
  user: () => get<UserSession | null>('user', null),
  saveUser: (u: UserSession | null) => put('user', u),
  lastName: () => get<string>('name', ''),
  saveLastName: (n: string) => put('name', n),
};
