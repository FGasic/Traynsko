import type { KV } from './kv';
import { decrypt, deriveKeys, encrypt, newId, normPassword, readToken, sameText, signToken, verifySecret } from './crypto';
import type { AdminWorld, Emblem, GameRecord, GameSummary, Line, PlayerStats, PublicWorld, RepMeta } from '../shared/types';
import { playerKey } from '../shared/types';

export interface Req {
  method: string;
  path: string;                 // e.g. "/api/worlds"
  query: URLSearchParams;
  auth?: string;                // Authorization header
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
  createdAt: string;
  reps: RepMeta[];
}
interface WorldStats { players: Record<string, PlayerStats> }

type Session = { k: 'w'; w: string; v: number; iat: number } | { k: 'a'; iat: number; exp: number };

const K = {
  worlds: 'tr:worlds',
  world: (id: string) => `tr:w:${id}`,
  rep: (id: string) => `tr:rep:${id}`,
  game: (id: string) => `tr:g:${id}`,
  worldGames: (id: string) => `tr:wg:${id}`,
  stats: (id: string) => `tr:ws:${id}`,
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

export function createApp(getKV: () => Promise<KV>, masterHash: string | undefined) {
  const keys = masterHash ? deriveKeys(masterHash) : null;

  async function limit(kv: KV, scope: string, ip: string, max: number, windowSec: number) {
    const n = await kv.hit(K.rl(scope, ip), windowSec);
    if (n > max) fail(429, 'too_many', 'Demasiados intentos. Espera unos minutos y vuelve a probar.');
  }

  async function loadWorld(kv: KV, id: string): Promise<WorldDoc> {
    const w = await kv.get<WorldDoc>(K.world(id));
    if (!w) fail(404, 'world_not_found', 'Ese repertorio ya no existe.');
    return w!;
  }

  async function auth(kv: KV, req: Req): Promise<{ role: 'admin' } | { role: 'world'; world: WorldDoc }> {
    if (!keys) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
    const raw = (req.auth ?? '').replace(/^Bearer\s+/i, '');
    const s = raw ? readToken<Session>(raw, keys!.sign) : null;
    if (!s) fail(401, 'no_session', 'Entra de nuevo a tu repertorio.');
    if (s!.k === 'a') {
      if (s!.exp < Date.now()) fail(401, 'admin_expired', 'Tu acceso maestro caducó. Escribe la clave maestra otra vez.');
      return { role: 'admin' };
    }
    const w = await kv.get<WorldDoc>(K.world(s!.w));
    if (!w || !w.active) fail(401, 'world_closed', 'Este repertorio ya no está disponible.');
    if (w!.pwv !== s!.v) fail(401, 'password_changed', 'La clave de este repertorio cambió. Escribe la nueva para seguir.');
    return { role: 'world', world: w! };
  }

  async function requireAdmin(kv: KV, req: Req) {
    const a = await auth(kv, req);
    if (a.role !== 'admin') fail(403, 'admin_only', 'Solo con la clave maestra.');
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
    await bumpStats(kv, g.worldId, g, -1);
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
      const worlds = (await allWorlds(kv)).filter((w) => w.active).map(toPublic);
      return { status: 200, body: { worlds } };
    }

    if (a === 'enter' && M === 'POST') {
      if (!keys) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
      await limit(kv, 'enter', req.ip, 20, 600);
      const w = await loadWorld(kv, str(req.body?.world, 40, 'repertorio'));
      if (!w.active) fail(404, 'world_not_found', 'Ese repertorio no está disponible.');
      const given = normPassword(str(req.body?.password, 200, 'la clave'));
      const real = decrypt(w.pw, keys!.enc);
      if (real === null || !sameText(given, normPassword(real))) fail(401, 'wrong_password', 'Clave incorrecta.');
      const token = signToken({ k: 'w', w: w.id, v: w.pwv, iat: Date.now() }, keys!.sign);
      return { status: 200, body: { token, world: toPublic(w) } };
    }

    if (a === 'admin' && b === 'login' && M === 'POST') {
      if (!keys || !masterHash) fail(503, 'not_configured', 'Falta configurar la clave maestra en el servidor.');
      await limit(kv, 'admin', req.ip, 8, 900);
      const pw = str(req.body?.password, 200, 'la clave maestra');
      if (!verifySecret(pw, masterHash!)) fail(401, 'wrong_password', 'Clave maestra incorrecta.');
      const token = signToken({ k: 'a', iat: Date.now(), exp: Date.now() + 30 * 864e5 }, keys!.sign);
      return { status: 200, body: { token } };
    }

    /* ---------- student or admin ---------- */
    if (a === 'session' && M === 'GET') {
      const s = await auth(kv, req);
      return { status: 200, body: s.role === 'world' ? { role: 'world', world: toPublic(s.world) } : { role: 'admin' } };
    }

    if (a === 'content' && M === 'GET') {
      const s = await auth(kv, req);
      if (s.role !== 'world') fail(400, 'invalid', 'Entra a un repertorio.');
      const w = (s as { world: WorldDoc }).world;
      const docs = await kv.mget<{ lines: Line[] }>(w.reps.map((r) => K.rep(r.id)));
      const reps = w.reps.map((r, i) => ({ ...r, lines: docs[i]?.lines ?? [] }));
      return { status: 200, body: { world: toPublic(w), reps } };
    }

    if (a === 'games' && !b && M === 'POST') {
      const s = await auth(kv, req);
      if (s.role !== 'world') fail(400, 'invalid', 'Entra a un repertorio.');
      const w = (s as { world: WorldDoc }).world;
      await limit(kv, 'save', req.ip, 120, 3600);
      const name = str(req.body?.player, 40, 'tu nombre');
      const g: GameRecord = {
        ...validGame(req.body?.game),
        id: newId(), worldId: w.id, worldName: w.name, playerName: name, playerKey: playerKey(name), date: new Date().toISOString(),
      };
      await kv.set(K.game(g.id), g);
      await kv.zadd(K.worldGames(w.id), Date.now(), g.id);
      await bumpStats(kv, w.id, g, 1);
      return { status: 200, body: { game: summary(g) } };
    }

    if (a === 'games' && !b && M === 'GET') {
      const s = await auth(kv, req);
      if (s.role === 'world') {
        const name = str(req.query.get('player'), 40, 'tu nombre');
        return { status: 200, body: { games: await listGames(kv, s.world.id, playerKey(name)) } };
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
        if (M === 'DELETE' && g!.playerKey !== playerKey(req.query.get('player') ?? '')) fail(403, 'not_yours', 'Solo puedes borrar tus partidas.');
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
        const worlds: AdminWorld[] = docs.map((w, i) => ({
          ...toPublic(w),
          password: decrypt(w.pw, keys!.enc) ?? '',
          active: w.active,
          createdAt: w.createdAt,
          reps: w.reps,
          gameCount: counts[i],
          players: Object.values(stats[i]?.players ?? {}).sort((x, y) => y.last.localeCompare(x.last)),
        }));
        return { status: 200, body: { worlds } };
      }

      if (b === 'enter' && M === 'POST') {
        const w = await loadWorld(kv, str(req.body?.world, 40, 'repertorio'));
        const token = signToken({ k: 'w', w: w.id, v: w.pwv, iat: Date.now() }, keys!.sign);
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
        await kv.del(...gameIds.map(K.game), ...w.reps.map((r) => K.rep(r.id)), K.worldGames(w.id), K.stats(w.id), K.world(w.id));
        const ids = (await kv.get<string[]>(K.worlds)) ?? [];
        await kv.set(K.worlds, ids.filter((x) => x !== w.id));
        return { status: 200, body: { ok: true } };
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
