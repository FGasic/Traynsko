import type { KV } from './kv';
import { decrypt, deriveKeys, encrypt, newId, normPassword, readToken, sameText, signToken, verifySecret } from './crypto';
import type { AdminWorld, Emblem, GameRecord, GameSummary, Line, Member, PlayerStats, PublicWorld, RepMeta } from '../shared/types';
import { playerKey } from '../shared/types';
import { ACCOUNT_PREFIX, accountKey, lineFingerprint, type Medal, type UserInfo } from '../shared/atlas';
import { lichessClient, type LichessClient } from './lichess';

export interface Req {
  method: string;
  path: string;                 // e.g. "/api/worlds"
  query: URLSearchParams;
  auth?: string;                // Authorization header: world or master session
  user?: string;                // X-Traynsko-User header: Lichess account session
  player?: string;              // X-Traynsko-Player header: the guest name typed on this device (URI-encoded)
  body: any;
  ip: string;
}
export interface Res { status: number; body: unknown }

interface WorldDoc {
  id: string;
  name: string;
  subtitle: string;
  emblem: Emblem;
  hue: number;
  pw: string;        // AES-GCM encrypted password
  pwv: number;       // bumps on every password change: invalidates sessions
  active: boolean;
  listed?: boolean;  // in the public Biblioteca (missing = yes, for repertoires created before the setting)
  accountOnly?: boolean;
  createdAt: string;
  reps: RepMeta[];
}
interface WorldStats { players: Record<string, PlayerStats> }
interface UserDoc {
  id: string;        // Lichess id (lower case)
  name: string;      // Lichess username as displayed
  v: number;         // bumps to sign out every device
  createdAt: string;
  lastSeen: string;
  claims: string[];  // "worldId|guestKey" names whose old games were moved to this account
}

/** World session: `m` who entered (player key), `n` the guest name, `adm` issued to the master (never tracked or blocked). */
type Session = { k: 'w'; w: string; v: number; iat: number; m?: string; n?: string; adm?: 1 } | { k: 'a'; iat: number; exp: number };
type UserSession = { k: 'u'; u: string; v: number; iat: number; exp: number };

const USER_TTL = 180 * 864e5;
const LICHESS_ID = /^[a-z0-9][a-z0-9_-]{0,29}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const K = {
  worlds: 'tr:worlds',
  world: (id: string) => `tr:w:${id}`,
  rep: (id: string) => `tr:rep:${id}`,
  game: (id: string) => `tr:g:${id}`,
  worldGames: (id: string) => `tr:wg:${id}`,
  stats: (id: string) => `tr:ws:${id}`,
  user: (id: string) => `tr:u:${id}`,
  medals: (id: string) => `tr:um:${id}`,
  userGames: (id: string) => `tr:ug:${id}`,
  claim: (worldId: string, guest: string) => `tr:claim:${worldId}:${guest}`,
  members: (worldId: string) => `tr:wm:${worldId}`,
  rl: (scope: string, ip: string) => `tr:rl:${scope}:${ip}`,
};

const EMBLEMS: Emblem[] = ['knight', 'rook', 'bishop', 'queen', 'king', 'pawn'];
const UCI_LINE = /^[a-h][1-8][a-h][1-8][qrbn]?( [a-h][1-8][a-h][1-8][qrbn]?)*$/;
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}
const fail = (status: number, code: string, message?: string): never => { throw new HttpError(status, code, message); };

const str = (v: unknown, max: number, field: string, required = true): string => {
  if (v === undefined || v === null || v === '') { if (required) fail(400, 'invalid', `Falta ${field}.`); return ''; }
  if (typeof v !== 'string') fail(400, 'invalid', `${field} no es texto.`);
  const s = (v as string).trim();
  if (s.length > max) fail(400, 'invalid', `${field} es demasiado largo.`);
  if (required && !s) fail(400, 'invalid', `Falta ${field}.`);
  return s;
};

const listed = (w: WorldDoc) => w.listed !== false;
const BLOCKED = 'Tu acceso a este repertorio está suspendido. Habla con tu entrenador.';
const NEEDS_ACCOUNT = 'Este repertorio se abre con tu cuenta de Lichess: entra con Lichess y vuelve a escribir la clave.';

function toPublic(w: WorldDoc): PublicWorld {
  return {
    id: w.id, name: w.name, subtitle: w.subtitle, emblem: w.emblem, hue: w.hue,
    repCount: w.reps.length, lineCount: w.reps.reduce((n, r) => n + r.lineCount, 0),
  };
}

function summary(g: GameRecord): GameSummary {
  const { sans, clocks, ...rest } = g;
  return { ...rest, plies: sans.length };
}

function outcomePoints(g: Pick<GameRecord, 'result' | 'userColor'>) {
  if (g.result === '1/2-1/2') return 0.5;
  return (g.result === '1-0') === (g.userColor === 'w') ? 1 : 0;
}

/** Player key for a game saved without an account. Names that would look like an account are refused. */
function guestKey(name: string): string {
  const k = playerKey(name);
  if (k.startsWith(ACCOUNT_PREFIX)) fail(400, 'invalid', 'Ese nombre no está permitido.');
  return k;
}
const guestKeyOrNull = (name: string | null | undefined) => {
  const k = name ? playerKey(name) : '';
  return k && !k.startsWith(ACCOUNT_PREFIX) ? k : null;
};
const headerName = (v: string | undefined) => {
  if (!v) return null;
  try { const n = decodeURIComponent(v).trim().slice(0, 40); return n || null; } catch { return null; }
};

function validRedirect(v: unknown): string {
  const s = str(v, 300, 'redirectUri');
  let u: URL;
  try { u = new URL(s); } catch { return fail(400, 'invalid', 'Dirección de retorno no válida.'); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) fail(400, 'invalid', 'Dirección de retorno no válida.');
  if (u.search || u.hash) fail(400, 'invalid', 'Dirección de retorno no válida.');
  return s;
}

export function createApp(getKV: () => Promise<KV>, masterHash: string | undefined, opts: { lichess?: LichessClient } = {}) {
  const keys = masterHash ? deriveKeys(masterHash) : null;
  const lichess = opts.lichess ?? lichessClient();

  async function limit(kv: KV, scope: string, ip: string, max: number, windowSec: number) {
    const n = await kv.hit(K.rl(scope, ip), windowSec);
    if (n > max) fail(429, 'too_many', 'Demasiados intentos. Espera unos minutos y vuelve a probar.');
  }

  async function loadWorld(kv: KV, id: string): Promise<WorldDoc> {
    const w = await kv.get<WorldDoc>(K.world(id));
    if (!w) fail(404, 'world_not_found', 'Ese repertorio ya no existe.');
    return w!;
  }

  /** The Lichess account in the X-Traynsko-User header, checked by signature only (no database read). */
  function accountIdOf(req: Req): string | null {
    const raw = (req.user ?? '').trim();
    if (!raw || !keys) return null;
    const s = readToken<UserSession>(raw, keys.sign);
    return s && s.k === 'u' && s.exp > Date.now() ? s.u : null;
  }

  async function memberOf(kv: KV, worldId: string, id: string) { return kv.hget<Member>(K.members(worldId), id); }

  /** Record (or refresh) who is using a repertoire. A block, once set, is kept. */
  async function touchMember(kv: KV, worldId: string, id: string, kind: Member['kind'], name: string) {
    const now = new Date().toISOString();
    const prev = await memberOf(kv, worldId, id);
    const m: Member = { ...(prev ?? { id, kind, first: now }), id, kind, name: name.slice(0, 40), last: now };
    await kv.hset(K.members(worldId), id, m);
    return m;
  }

  type WorldAuth = { role: 'world'; world: WorldDoc; session: Extract<Session, { k: 'w' }>; member: string | null; account: string | null };
  async function auth(kv: KV, req: Req): Promise<{ role: 'admin' } | WorldAuth> {
    if (!keys) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
    const raw = (req.auth ?? '').replace(/^Bearer\s+/i, '');
    const s = raw ? readToken<Session>(raw, keys!.sign) : null;
    if (!s) fail(401, 'no_session', 'Entra de nuevo a tu repertorio.');
    if (s!.k === 'a') {
      if (s!.exp < Date.now()) fail(401, 'admin_expired', 'Tu acceso maestro caducó. Escribe la clave maestra otra vez.');
      return { role: 'admin' };
    }
    const ws = s as Extract<Session, { k: 'w' }>;
    const w = await kv.get<WorldDoc>(K.world(ws.w));
    if (!w || !w.active) fail(401, 'world_closed', 'Este repertorio ya no está disponible.');
    if (w!.pwv !== ws.v) fail(401, 'password_changed', 'La clave de este repertorio cambió. Escribe la nueva para seguir.');
    if (ws.adm) return { role: 'world', world: w!, session: ws, member: null, account: null };
    // who is this: the account if signed in, else whoever entered with this token, else the name typed on the device
    const account = accountIdOf(req);
    if (w!.accountOnly && !account) fail(401, 'account_required', NEEDS_ACCOUNT);
    const member = account ? accountKey(account) : ws.m ?? guestKeyOrNull(headerName(req.player));
    if (member && (await memberOf(kv, w!.id, member))?.blocked) fail(403, 'access_blocked', BLOCKED);
    return { role: 'world', world: w!, session: ws, member, account };
  }

  async function requireAdmin(kv: KV, req: Req) {
    const a = await auth(kv, req);
    if (a.role !== 'admin') fail(403, 'admin_only', 'Solo con la clave maestra.');
  }

  /** The Lichess account behind the X-Traynsko-User header (verified: signed by us, user still exists). */
  async function userOf(kv: KV, req: Req, required: true): Promise<UserDoc>;
  async function userOf(kv: KV, req: Req, required: false): Promise<UserDoc | null>;
  async function userOf(kv: KV, req: Req, required: boolean): Promise<UserDoc | null> {
    if (!keys) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
    const raw = (req.user ?? '').trim();
    if (!raw) { if (required) fail(401, 'no_account', 'Entra con tu cuenta de Lichess.'); return null; }
    const s = readToken<UserSession>(raw, keys!.sign);
    if (!s || s.k !== 'u' || s.exp < Date.now()) fail(401, 'account_expired', 'Tu sesión de Lichess caducó. Entra de nuevo.');
    const u = await kv.get<UserDoc>(K.user(s!.u));
    if (!u || u.v !== s!.v) fail(401, 'account_expired', 'Tu sesión de Lichess caducó. Entra de nuevo.');
    return u!;
  }

  const info = (u: UserDoc): UserInfo => ({ id: u.id, name: u.name });

  async function worldUser(kv: KV, req: Req) {
    const s = await auth(kv, req);
    if (s.role !== 'world') fail(400, 'invalid', 'Entra a un repertorio.');
    const user = await userOf(kv, req, true);
    return { world: (s as { world: WorldDoc }).world, user };
  }

  async function allWorlds(kv: KV): Promise<WorldDoc[]> {
    const ids = (await kv.get<string[]>(K.worlds)) ?? [];
    const docs = await kv.mget<WorldDoc>(ids.map(K.world));
    return docs.filter(Boolean) as WorldDoc[];
  }

  function validLines(lines: unknown): Line[] {
    if (!Array.isArray(lines) || lines.length === 0) fail(400, 'invalid', 'El capítulo no tiene líneas.');
    if ((lines as unknown[]).length > 3000) fail(400, 'invalid', 'Máximo 3000 líneas por capítulo.');
    return (lines as any[]).map((l, i) => {
      const uci = str(l?.uci, 4000, `la línea ${i + 1}`);
      if (!UCI_LINE.test(uci)) fail(400, 'invalid', `La línea ${i + 1} tiene jugadas no válidas.`);
      const line: Line = {
        id: str(l?.id, 40, 'id') ,
        event: str(l?.event, 200, 'Event', false),
        white: str(l?.white, 200, 'White', false),
        black: str(l?.black, 200, 'Black', false),
        uci,
      };
      if (l?.fen) line.fen = str(l.fen, 100, 'FEN');
      return line;
    });
  }

  function validGame(g: any): Omit<GameRecord, 'id' | 'worldId' | 'worldName' | 'playerName' | 'playerKey' | 'date'> {
    if (!g || typeof g !== 'object') fail(400, 'invalid', 'Partida vacía.');
    if (!Array.isArray(g.sans) || g.sans.length > 800 || g.sans.some((s: unknown) => typeof s !== 'string' || s.length > 10)) fail(400, 'invalid', 'Jugadas no válidas.');
    if (!Array.isArray(g.clocks) || g.clocks.length !== g.sans.length || g.clocks.some((c: unknown) => typeof c !== 'number' || !isFinite(c as number))) fail(400, 'invalid', 'Reloj no válido.');
    if (!RESULTS.has(g.result)) fail(400, 'invalid', 'Resultado no válido.');
    const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && v >= min && v <= max ? Math.round(v) : fail(400, 'invalid', 'Número fuera de rango.')) as number;
    return {
      repId: str(g.repId, 40, 'repId'),
      repName: str(g.repName, 120, 'repName'),
      lineId: str(g.lineId, 40, 'lineId'),
      lineEvent: str(g.lineEvent, 200, 'lineEvent', false),
      lineWhite: str(g.lineWhite, 200, 'lineWhite', false),
      lineBlack: str(g.lineBlack, 200, 'lineBlack', false),
      userColor: g.userColor === 'b' ? 'b' : 'w',
      botId: str(g.botId, 40, 'botId'),
      botName: str(g.botName, 60, 'botName'),
      botElo: num(g.botElo, 800, 3600),
      result: g.result,
      termination: str(g.termination, 80, 'termination', false),
      timeControl: str(g.timeControl, 20, 'timeControl'),
      ...(g.startFen ? { startFen: str(g.startFen, 100, 'startFen') } : {}),
      sans: g.sans,
      clocks: g.clocks.map((c: number) => Math.max(0, Math.round(c))),
      linePlies: num(g.linePlies, 0, 800),
      lineErrors: num(g.lineErrors, 0, 100000),
    };
  }

  async function bumpStats(kv: KV, worldId: string, g: GameRecord, sign: 1 | -1) {
    const st = (await kv.get<WorldStats>(K.stats(worldId))) ?? { players: {} };
    const p = st.players[g.playerKey] ?? { name: g.playerName, games: 0, points: 0, lineErrors: 0, last: g.date };
    p.games += sign;
    p.points += sign * outcomePoints(g);
    p.lineErrors += sign * g.lineErrors;
    if (sign > 0) { p.name = g.playerName; if (g.date > p.last) p.last = g.date; }
    if (p.games <= 0) delete st.players[g.playerKey]; else st.players[g.playerKey] = p;
    await kv.set(K.stats(worldId), st);
  }

  async function listGames(kv: KV, worldId: string, pkey?: string): Promise<GameSummary[]> {
    const ids = await kv.zrevrange(K.worldGames(worldId), 0, 799);
    const games = (await kv.mget<GameRecord>(ids.map(K.game))).filter(Boolean) as GameRecord[];
    return games.filter((g) => !pkey || g.playerKey === pkey).map(summary);
  }

  async function deleteGame(kv: KV, g: GameRecord) {
    await kv.del(K.game(g.id));
    await kv.zrem(K.worldGames(g.worldId), g.id);
    if (g.playerKey.startsWith(ACCOUNT_PREFIX)) await kv.srem(K.userGames(g.playerKey.slice(ACCOUNT_PREFIX.length)), g.id);
    await bumpStats(kv, g.worldId, g, -1);
  }

  /** Move every game saved under a guest name in one world to an account (stats follow). */
  async function claimGuestGames(kv: KV, worldId: string, gk: string, u: UserDoc): Promise<number> {
    const ids = await kv.zrevrange(K.worldGames(worldId), 0, -1);
    const games = (await kv.mget<GameRecord>(ids.map(K.game))).filter((g): g is GameRecord => !!g && g.playerKey === gk);
    const ak = accountKey(u.id);
    for (const g of games) {
      await kv.set(K.game(g.id), { ...g, playerName: u.name, playerKey: ak });
      await kv.sadd(K.userGames(u.id), g.id);
    }
    const st = (await kv.get<WorldStats>(K.stats(worldId))) ?? { players: {} };
    const from = st.players[gk];
    if (from) {
      const to = st.players[ak] ?? { name: u.name, games: 0, points: 0, lineErrors: 0, last: from.last };
      st.players[ak] = {
        name: u.name, games: to.games + from.games, points: to.points + from.points,
        lineErrors: to.lineErrors + from.lineErrors, last: from.last > to.last ? from.last : to.last,
      };
      delete st.players[gk];
      await kv.set(K.stats(worldId), st);
    }
    return games.length;
  }

  async function route(req: Req): Promise<Res> {
    const parts = req.path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const [a, b, c, d] = parts;
    const M = req.method.toUpperCase();

    if (a === 'health' && M === 'GET') {
      let db = false;
      try { const kv = await getKV(); await kv.get('tr:ping'); db = true; } catch { db = false; }
      return { status: 200, body: { ok: db && !!keys, db, master: !!keys } };
    }

    const kv = await getKV().catch(() => fail(503, 'no_database', 'La base de datos no está conectada.'));

    /* ---------- public ---------- */
    if (a === 'worlds' && !b && M === 'GET') {
      const worlds = (await allWorlds(kv)).filter((w) => w.active && listed(w)).map(toPublic);
      return { status: 200, body: { worlds } };
    }

    if (a === 'enter' && M === 'POST') {
      if (!keys) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
      await limit(kv, 'enter', req.ip, 20, 600);
      const opens = (w: WorldDoc, given: string) => { const real = decrypt(w.pw, keys!.enc); return real !== null && sameText(given, normPassword(real)); };
      // who is entering: a Lichess account, or a guest by the name they typed
      const user = await userOf(kv, req, false);
      const guestName = user ? null : str(req.body?.name, 40, 'tu nombre', false) || null;
      const member = user ? accountKey(user.id) : guestKeyOrNull(guestName);
      const refusal = async (w: WorldDoc): Promise<'account_required' | 'access_blocked' | null> => {
        if (w.accountOnly && !user) return 'account_required';
        if (member && (await memberOf(kv, w.id, member))?.blocked) return 'access_blocked';
        return null;
      };
      const entry = async (w: WorldDoc) => {
        if (member) await touchMember(kv, w.id, member, user ? 'account' : 'guest', user ? user.name : guestName!);
        const tok = { k: 'w' as const, w: w.id, v: w.pwv, iat: Date.now(), ...(member ? { m: member } : {}), ...(guestName ? { n: guestName } : {}) };
        return { token: signToken(tok, keys!.sign), world: toPublic(w) };
      };
      const refuse = (why: 'account_required' | 'access_blocked') => fail(why === 'access_blocked' ? 403 : 401, why, why === 'access_blocked' ? BLOCKED : NEEDS_ACCOUNT);
      if (req.body?.world === undefined || req.body?.world === null || req.body?.world === '') {
        // Only the key: it says which repertoire(s) it opens, so the cover never has to list them all.
        const given = normPassword(str(req.body?.password, 200, 'la clave'));
        const matches = (await allWorlds(kv)).filter((w) => w.active && opens(w, given));
        if (!matches.length) fail(401, 'wrong_password', 'Esa clave no abre ningún repertorio.');
        const why = await Promise.all(matches.map(refusal));
        const allowed = matches.filter((_, i) => !why[i]);
        if (!allowed.length) refuse(why.includes('access_blocked') ? 'access_blocked' : 'account_required');
        return { status: 200, body: { entries: await Promise.all(allowed.map(entry)) } };
      }
      const w = await loadWorld(kv, str(req.body?.world, 40, 'repertorio'));
      if (!w.active) fail(404, 'world_not_found', 'Ese repertorio no está disponible.');
      const given = normPassword(str(req.body?.password, 200, 'la clave'));
      if (!opens(w, given)) fail(401, 'wrong_password', 'Clave incorrecta.');
      const why = await refusal(w);
      if (why) refuse(why);
      return { status: 200, body: await entry(w) };
    }

    if (a === 'admin' && b === 'login' && M === 'POST') {
      if (!keys || !masterHash) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
      await limit(kv, 'admin', req.ip, 8, 900);
      const pw = str(req.body?.password, 200, 'la clave maestra');
      if (!verifySecret(pw, masterHash!)) fail(401, 'wrong_password', 'Clave maestra incorrecta.');
      const token = signToken({ k: 'a', iat: Date.now(), exp: Date.now() + 30 * 864e5 }, keys!.sign);
      return { status: 200, body: { token } };
    }

    /* ---------- Lichess account ---------- */
    if (a === 'auth' && b === 'lichess' && M === 'POST') {
      if (!keys) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
      await limit(kv, 'login', req.ip, 30, 600);
      const code = str(req.body?.code, 300, 'code');
      const verifier = str(req.body?.verifier, 128, 'verifier');
      if (!PKCE_VERIFIER.test(verifier)) fail(400, 'invalid', 'Solicitud de acceso no válida.');
      const redirectUri = validRedirect(req.body?.redirectUri);
      let who: { id: string; username: string };
      try { who = await lichess.identify(code, verifier, redirectUri); }
      catch (e) { console.error('lichess login', e); return fail(502, 'lichess_failed', 'Lichess no confirmó tu cuenta. Vuelve a intentarlo.'); }
      if (!LICHESS_ID.test(who.id)) fail(502, 'lichess_failed', 'Lichess devolvió una cuenta no válida.');
      const now = new Date().toISOString();
      const prev = await kv.get<UserDoc>(K.user(who.id));
      const u: UserDoc = prev
        ? { ...prev, name: who.username.slice(0, 40), lastSeen: now }
        : { id: who.id, name: who.username.slice(0, 40), v: 1, createdAt: now, lastSeen: now, claims: [] };
      await kv.set(K.user(u.id), u);
      const token = signToken({ k: 'u', u: u.id, v: u.v, iat: Date.now(), exp: Date.now() + USER_TTL }, keys!.sign);
      return { status: 200, body: { token, user: info(u) } };
    }

    if (a === 'me' && !b && M === 'GET') {
      const u = await userOf(kv, req, true);
      const medals = (await kv.get<Record<string, Medal>>(K.medals(u.id))) ?? {};
      return { status: 200, body: { user: info(u), medals: Object.keys(medals).length } };
    }

    if (a === 'me' && !b && M === 'DELETE') {
      const u = await userOf(kv, req, true);
      const ids = await kv.smembers(K.userGames(u.id));
      const games = (await kv.mget<GameRecord>(ids.map(K.game))).filter(Boolean) as GameRecord[];
      for (const g of games) await deleteGame(kv, g);
      const ak = accountKey(u.id);
      for (const w of await allWorlds(kv)) {
        const m = await memberOf(kv, w.id, ak);
        if (!m) continue;
        if (m.blocked) await kv.hset(K.members(w.id), ak, { ...m, name: 'Cuenta borrada' });   // a block survives the account
        else await kv.hdel(K.members(w.id), ak);
      }
      const claimKeys = u.claims.map((c) => { const [w, gk] = c.split('|'); return K.claim(w, gk); });
      await kv.del(K.userGames(u.id), K.medals(u.id), K.user(u.id), ...claimKeys);
      return { status: 200, body: { ok: true, games: games.length } };
    }

    if (a === 'me' && b === 'logout-all' && M === 'POST') {
      const u = await userOf(kv, req, true);
      await kv.set(K.user(u.id), { ...u, v: u.v + 1 });
      return { status: 200, body: { ok: true } };
    }

    if (a === 'me' && b === 'claim' && (M === 'GET' || M === 'POST')) {
      const { world, user } = await worldUser(kv, req);
      const gk = guestKey(str(M === 'GET' ? req.query.get('name') : req.body?.name, 40, 'el nombre'));
      const owner = await kv.get<string>(K.claim(world.id, gk));
      if (M === 'GET') {
        const games = (await listGames(kv, world.id, gk)).length;
        return { status: 200, body: { games, claimed: owner ? (owner === user.id ? 'you' : 'other') : null } };
      }
      if (owner && owner !== user.id) fail(409, 'claimed', 'Las partidas de ese nombre ya pertenecen a otra cuenta.');
      await limit(kv, 'claim', req.ip, 20, 3600);
      const moved = await claimGuestGames(kv, world.id, gk, user);
      if (moved === 0) fail(404, 'nothing_to_claim', 'No hay partidas guardadas con ese nombre en este repertorio.');
      await kv.set(K.claim(world.id, gk), user.id);
      const tag = `${world.id}|${gk}`;
      if (!user.claims.includes(tag)) await kv.set(K.user(user.id), { ...user, claims: [...user.claims, tag] });
      return { status: 200, body: { games: moved } };
    }

    /* ---------- medals ---------- */
    if (a === 'medals' && !b && M === 'GET') {
      const u = await userOf(kv, req, true);
      const medals = (await kv.get<Record<string, Medal>>(K.medals(u.id))) ?? {};
      return { status: 200, body: { medals: Object.values(medals) } };
    }

    if (a === 'medals' && !b && M === 'POST') {
      const { world, user } = await worldUser(kv, req);
      await limit(kv, 'medal', req.ip, 300, 3600);
      const p = req.body ?? {};
      const rep = world.reps.find((r) => r.id === str(p.repId, 40, 'repId'));
      if (!rep) fail(404, 'rep_not_found', 'Ese capítulo ya no existe.');
      const doc = await kv.get<{ lines: Line[] }>(K.rep(rep!.id));
      const line = doc?.lines.find((l) => l.id === str(p.lineId, 40, 'lineId'));
      if (!line) fail(404, 'line_not_found', 'Esa línea ya no existe en el capítulo.');
      if (p.errors !== 0 || p.hints !== 0) fail(400, 'not_perfect', 'El emblema exige la línea sin errores ni ayudas.');
      if (p.startPly !== 0) fail(400, 'not_from_start', 'El emblema exige empezar desde la jugada 1.');
      const fp = lineFingerprint(rep!.color, line!);
      const all = (await kv.get<Record<string, Medal>>(K.medals(user.id))) ?? {};
      const prev = all[fp];
      const now = new Date().toISOString();
      const medal: Medal = {
        fp, worldId: world.id, repId: rep!.id, repName: rep!.name, color: rep!.color,
        event: line!.event, white: line!.white, black: line!.black, plies: line!.uci.split(' ').length,
        first: prev?.first ?? now, last: now, count: (prev?.count ?? 0) + 1,
      };
      all[fp] = medal;
      await kv.set(K.medals(user.id), all);
      return { status: 200, body: { medal, isNew: !prev } };
    }

    /* ---------- student or admin ---------- */
    if (a === 'session' && M === 'GET') {
      const s = await auth(kv, req);
      return { status: 200, body: s.role === 'world' ? { role: 'world', world: toPublic(s.world) } : { role: 'admin' } };
    }

    if (a === 'content' && M === 'GET') {
      const s = await auth(kv, req);
      if (s.role !== 'world') fail(400, 'invalid', 'Entra a un repertorio.');
      const wa = s as WorldAuth;
      const w = wa.world;
      if (wa.member) {
        const u = wa.account ? await userOf(kv, req, false) : null;
        const name = u ? u.name : headerName(req.player) ?? wa.session.n ?? null;
        if (name) await touchMember(kv, w.id, wa.member, u ? 'account' : 'guest', name);
      }
      const docs = await kv.mget<{ lines: Line[] }>(w.reps.map((r) => K.rep(r.id)));
      const reps = w.reps.map((r, i) => ({ ...r, lines: docs[i]?.lines ?? [] }));
      return { status: 200, body: { world: toPublic(w), reps } };
    }

    if (a === 'games' && !b && M === 'POST') {
      const s = await auth(kv, req);
      if (s.role !== 'world') fail(400, 'invalid', 'Entra a un repertorio.');
      const w = (s as { world: WorldDoc }).world;
      await limit(kv, 'save', req.ip, 120, 3600);
      const user = await userOf(kv, req, false);
      const name = user ? user.name : str(req.body?.player, 40, 'tu nombre');
      const g: GameRecord = {
        ...validGame(req.body?.game),
        id: newId(), worldId: w.id, worldName: w.name, playerName: name, playerKey: user ? accountKey(user.id) : guestKey(name), date: new Date().toISOString(),
      };
      await kv.set(K.game(g.id), g);
      await kv.zadd(K.worldGames(w.id), Date.now(), g.id);
      if (user) await kv.sadd(K.userGames(user.id), g.id);
      await bumpStats(kv, w.id, g, 1);
      return { status: 200, body: { game: summary(g) } };
    }

    if (a === 'games' && !b && M === 'GET') {
      const s = await auth(kv, req);
      if (s.role === 'world') {
        const user = await userOf(kv, req, false);
        const key = user ? accountKey(user.id) : guestKey(str(req.query.get('player'), 40, 'tu nombre'));
        return { status: 200, body: { games: await listGames(kv, s.world.id, key) } };
      }
      const world = str(req.query.get('world'), 40, 'repertorio');
      const player = req.query.get('player');
      return { status: 200, body: { games: await listGames(kv, world, player ? playerKey(player) : undefined) } };
    }

    if (a === 'games' && b && (M === 'GET' || M === 'DELETE')) {
      const s = await auth(kv, req);
      const g = await kv.get<GameRecord>(K.game(b));
      if (!g) fail(404, 'game_not_found', 'Esa partida ya no existe.');
      if (s.role === 'world') {
        if (g!.worldId !== s.world.id) fail(404, 'game_not_found', 'Esa partida ya no existe.');
        if (M === 'DELETE') {
          const user = await userOf(kv, req, false);
          const mine = user ? accountKey(user.id) : guestKey(req.query.get('player') ?? '');
          if (g!.playerKey !== mine) fail(403, 'not_yours', 'Solo puedes borrar tus partidas.');
        }
      }
      if (M === 'GET') return { status: 200, body: { game: g } };
      await deleteGame(kv, g!);
      return { status: 200, body: { ok: true } };
    }

    /* ---------- admin ---------- */
    if (a === 'admin') {
      await requireAdmin(kv, req);

      if (b === 'overview' && M === 'GET') {
        const docs = await allWorlds(kv);
        const stats = await kv.mget<WorldStats>(docs.map((w) => K.stats(w.id)));
        const counts = await Promise.all(docs.map((w) => kv.zcard(K.worldGames(w.id))));
        const members = await Promise.all(docs.map((w) => kv.hgetall<Member>(K.members(w.id))));
        const worlds: AdminWorld[] = docs.map((w, i) => ({
          ...toPublic(w),
          password: decrypt(w.pw, keys!.enc) ?? '',
          active: w.active,
          listed: listed(w),
          accountOnly: !!w.accountOnly,
          createdAt: w.createdAt,
          reps: w.reps,
          gameCount: counts[i],
          players: Object.entries(stats[i]?.players ?? {}).map(([key, p]) => ({ ...p, key })).sort((x, y) => y.last.localeCompare(x.last)),
          members: Object.values(members[i]).sort((x, y) => y.last.localeCompare(x.last)),
        }));
        return { status: 200, body: { worlds } };
      }

      if (b === 'enter' && M === 'POST') {
        const w = await loadWorld(kv, str(req.body?.world, 40, 'repertorio'));
        const token = signToken({ k: 'w', w: w.id, v: w.pwv, iat: Date.now(), adm: 1 }, keys!.sign);
        return { status: 200, body: { token, world: toPublic(w) } };
      }

      if (b === 'worlds' && !c && M === 'POST') {
        const name = str(req.body?.name, 60, 'el nombre');
        const password = str(req.body?.password, 100, 'la clave');
        if (password.length < 4) fail(400, 'invalid', 'La clave debe tener al menos 4 caracteres.');
        const emblem = EMBLEMS.includes(req.body?.emblem) ? req.body.emblem : 'knight';
        const hue = typeof req.body?.hue === 'number' ? Math.round(req.body.hue) % 360 : 210;
        const w: WorldDoc = {
          id: newId(), name, subtitle: str(req.body?.subtitle, 120, 'la descripción', false), emblem, hue,
          pw: encrypt(password, keys!.enc), pwv: 1, active: true, createdAt: new Date().toISOString(), reps: [],
          listed: req.body?.listed === true, accountOnly: req.body?.accountOnly === true,
        };
        await kv.set(K.world(w.id), w);
        const ids = (await kv.get<string[]>(K.worlds)) ?? [];
        await kv.set(K.worlds, [...ids, w.id]);
        return { status: 200, body: { world: toPublic(w) } };
      }

      if (b === 'worlds' && c && !d && M === 'PATCH') {
        const w = await loadWorld(kv, c);
        const p = req.body ?? {};
        if (p.name !== undefined) w.name = str(p.name, 60, 'el nombre');
        if (p.subtitle !== undefined) w.subtitle = str(p.subtitle, 120, 'la descripción', false);
        if (p.emblem !== undefined && EMBLEMS.includes(p.emblem)) w.emblem = p.emblem;
        if (typeof p.hue === 'number') w.hue = Math.round(p.hue) % 360;
        if (typeof p.active === 'boolean') w.active = p.active;
        if (typeof p.listed === 'boolean') w.listed = p.listed;
        if (typeof p.accountOnly === 'boolean') w.accountOnly = p.accountOnly;
        if (p.password !== undefined) {
          const pw = str(p.password, 100, 'la clave');
          if (pw.length < 4) fail(400, 'invalid', 'La clave debe tener al menos 4 caracteres.');
          w.pw = encrypt(pw, keys!.enc);
          w.pwv += 1;
        }
        await kv.set(K.world(w.id), w);
        return { status: 200, body: { world: toPublic(w) } };
      }

      if (b === 'worlds' && c && !d && M === 'DELETE') {
        const w = await loadWorld(kv, c);
        const gameIds = await kv.zrevrange(K.worldGames(w.id), 0, -1);
        await kv.del(...gameIds.map(K.game), ...w.reps.map((r) => K.rep(r.id)), K.worldGames(w.id), K.stats(w.id), K.world(w.id), K.members(w.id));
        const ids = (await kv.get<string[]>(K.worlds)) ?? [];
        await kv.set(K.worlds, ids.filter((x) => x !== w.id));
        return { status: 200, body: { ok: true } };
      }

      if (b === 'worlds' && c && d === 'access' && M === 'POST') {
        const w = await loadWorld(kv, c);
        const id = str(req.body?.member, 80, 'la persona');
        if (typeof req.body?.blocked !== 'boolean') fail(400, 'invalid', 'Falta indicar si se bloquea.');
        const kind: Member['kind'] = id.startsWith(ACCOUNT_PREFIX) ? 'account' : 'guest';
        const now = new Date().toISOString();
        const prev = await memberOf(kv, w.id, id);
        const st = (await kv.get<WorldStats>(K.stats(w.id)))?.players[id];
        const name = prev?.name ?? st?.name ?? str(req.body?.name, 40, 'el nombre', false) ?? id;
        const m: Member = { id, kind, name: name || id, first: prev?.first ?? st?.last ?? now, last: prev?.last ?? st?.last ?? now };
        if (req.body.blocked) { m.blocked = true; m.blockedAt = now; }
        await kv.hset(K.members(w.id), id, m);
        return { status: 200, body: { member: m } };
      }

      if (b === 'worlds' && c && d === 'order' && M === 'POST') {
        const ids = (await kv.get<string[]>(K.worlds)) ?? [];
        const i = ids.indexOf(c);
        const dir = req.body?.dir === 'up' ? -1 : 1;
        if (i >= 0 && i + dir >= 0 && i + dir < ids.length) { [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]; await kv.set(K.worlds, ids); }
        return { status: 200, body: { ok: true } };
      }

      if (b === 'worlds' && c && d === 'reps' && M === 'POST') {
        const w = await loadWorld(kv, c);
        if (w.reps.length >= 40) fail(400, 'invalid', 'Máximo 40 capítulos por repertorio.');
        const lines = validLines(req.body?.lines);
        const meta: RepMeta = { id: newId(), name: str(req.body?.name, 80, 'el nombre'), color: req.body?.color === 'b' ? 'b' : 'w', lineCount: lines.length };
        await kv.set(K.rep(meta.id), { lines });
        w.reps.push(meta);
        await kv.set(K.world(w.id), w);
        return { status: 200, body: { rep: meta } };
      }

      if (b === 'worlds' && c && d === 'reps' && parts[4] && (M === 'PATCH' || M === 'DELETE')) {
        const w = await loadWorld(kv, c);
        const rep = w.reps.find((r) => r.id === parts[4]);
        if (!rep) fail(404, 'rep_not_found', 'Ese capítulo ya no existe.');
        if (M === 'DELETE') {
          w.reps = w.reps.filter((r) => r.id !== rep!.id);
          await kv.del(K.rep(rep!.id));
        } else {
          const p = req.body ?? {};
          if (p.name !== undefined) rep!.name = str(p.name, 80, 'el nombre');
          if (p.color === 'w' || p.color === 'b') rep!.color = p.color;
        }
        await kv.set(K.world(w.id), w);
        return { status: 200, body: { ok: true } };
      }
    }

    return fail(404, 'not_found', 'Ruta desconocida.');
  }

  return async function handle(req: Req): Promise<Res> {
    try {
      return await route(req);
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.code, message: e.message } };
      console.error(e);
      return { status: 500, body: { error: 'server_error', message: 'Error del servidor. Inténtalo de nuevo.' } };
    }
  };
}
