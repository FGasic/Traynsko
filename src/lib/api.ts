import type { AdminWorld, Emblem, GameRecord, GameSummary, Line, Member, PublicWorld, RepMeta, Repertoire } from '../../shared/types';
import type { Medal, UserInfo } from '../../shared/atlas';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Lichess account session: sent with every request while the player is signed in. */
let userToken: string | null = null;
export const setUserToken = (t: string | null) => { userToken = t; };
/** The guest name used on this device, so the server knows who is playing (and can honour a block). */
let playerName: string | null = null;
export const setPlayerName = (n: string | null) => { playerName = n; };

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/' + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(userToken ? { 'X-Traynsko-User': userToken } : {}),
        ...(playerName ? { 'X-Traynsko-Player': encodeURIComponent(playerName) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Sin conexión. Revisa internet y vuelve a intentarlo.');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Algo salió mal. Inténtalo de nuevo.');
  return data as T;
}

export type NewGame = Omit<GameRecord, 'id' | 'worldId' | 'worldName' | 'playerName' | 'playerKey' | 'date'>;
export type WorldInput = { name: string; subtitle: string; emblem: Emblem; hue: number; password?: string; active?: boolean; listed?: boolean; accountOnly?: boolean };

const q = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, v));
  const s = p.toString();
  return s ? '?' + s : '';
};

export const api = {
  health: () => call<{ ok: boolean; db: boolean; master: boolean }>('GET', 'health'),
  worlds: () => call<{ worlds: PublicWorld[] }>('GET', 'worlds').then((r) => r.worlds),
  enter: (world: string, password: string, name?: string) => call<{ token: string; world: PublicWorld }>('POST', 'enter', { world, password, name }),
  /** Enter with only the key: every active repertoire it opens. */
  enterWithKey: (password: string, name?: string) => call<{ entries: { token: string; world: PublicWorld }[] }>('POST', 'enter', { password, name }).then((r) => r.entries),
  session: (t: string) => call<{ role: string; world?: PublicWorld }>('GET', 'session', undefined, t),
  content: (t: string) => call<{ world: PublicWorld; reps: Repertoire[] }>('GET', 'content', undefined, t),
  saveGame: (t: string, player: string, game: NewGame) => call<{ game: GameSummary }>('POST', 'games', { player, game }, t).then((r) => r.game),
  myGames: (t: string, player: string) => call<{ games: GameSummary[] }>('GET', 'games' + q({ player }), undefined, t).then((r) => r.games),
  game: (t: string, id: string) => call<{ game: GameRecord }>('GET', 'games/' + id, undefined, t).then((r) => r.game),
  deleteMyGame: (t: string, id: string, player: string) => call('DELETE', 'games/' + id + q({ player }), undefined, t),

  lichessLogin: (code: string, verifier: string, redirectUri: string) => call<{ token: string; user: UserInfo }>('POST', 'auth/lichess', { code, verifier, redirectUri }),
  me: () => call<{ user: UserInfo; medals: number }>('GET', 'me'),
  deleteAccount: () => call<{ ok: true; games: number }>('DELETE', 'me'),
  logoutAll: () => call('POST', 'me/logout-all'),
  claimPreview: (t: string, name: string) => call<{ games: number; claimed: 'you' | 'other' | null }>('GET', 'me/claim' + q({ name }), undefined, t),
  claim: (t: string, name: string) => call<{ games: number }>('POST', 'me/claim', { name }, t),
  medals: () => call<{ medals: Medal[] }>('GET', 'medals').then((r) => r.medals),
  awardMedal: (t: string, m: { repId: string; lineId: string; startPly: number; errors: number; hints: number }) =>
    call<{ medal: Medal; isNew: boolean }>('POST', 'medals', m, t),

  admin: {
    login: (password: string) => call<{ token: string }>('POST', 'admin/login', { password }).then((r) => r.token),
    overview: (t: string) => call<{ worlds: AdminWorld[] }>('GET', 'admin/overview', undefined, t).then((r) => r.worlds),
    enter: (t: string, world: string) => call<{ token: string; world: PublicWorld }>('POST', 'admin/enter', { world }, t),
    createWorld: (t: string, w: WorldInput) => call<{ world: PublicWorld }>('POST', 'admin/worlds', w, t).then((r) => r.world),
    updateWorld: (t: string, id: string, patch: Partial<WorldInput>) => call('PATCH', 'admin/worlds/' + id, patch, t),
    deleteWorld: (t: string, id: string) => call('DELETE', 'admin/worlds/' + id, undefined, t),
    moveWorld: (t: string, id: string, dir: 'up' | 'down') => call('POST', `admin/worlds/${id}/order`, { dir }, t),
    /** Block or restore one person's access to one repertoire (the key stays the same for everyone else). */
    setAccess: (t: string, world: string, member: string, blocked: boolean, name?: string) =>
      call<{ member: Member }>('POST', `admin/worlds/${world}/access`, { member, blocked, name }, t).then((r) => r.member),
    addRep: (t: string, world: string, rep: { name: string; color: 'w' | 'b'; lines: Line[] }) => call<{ rep: RepMeta }>('POST', `admin/worlds/${world}/reps`, rep, t).then((r) => r.rep),
    updateRep: (t: string, world: string, rep: string, patch: { name?: string; color?: 'w' | 'b' }) => call('PATCH', `admin/worlds/${world}/reps/${rep}`, patch, t),
    deleteRep: (t: string, world: string, rep: string) => call('DELETE', `admin/worlds/${world}/reps/${rep}`, undefined, t),
    games: (t: string, world: string, player?: string) => call<{ games: GameSummary[] }>('GET', 'games' + q({ world, player }), undefined, t).then((r) => r.games),
    game: (t: string, id: string) => call<{ game: GameRecord }>('GET', 'games/' + id, undefined, t).then((r) => r.game),
    deleteGame: (t: string, id: string) => call('DELETE', 'games/' + id, undefined, t),
  },
};
