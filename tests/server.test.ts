import { createApp } from '../server/core';
import { memoryKV } from '../server/kv';
import { hashSecret } from '../server/crypto';
import { parseRepertoire } from '../src/lib/pgn';
import { readFileSync } from 'node:fs';
import { lineFingerprint } from '../shared/atlas';
import { lichessClient } from '../server/lichess';

const kv = memoryKV();
const fakeLichess = {
  identify: async (code: string, verifier: string, redirectUri: string) => {
    if (code === 'bad') throw new Error('rejected');
    if (!verifier || !redirectUri) throw new Error('missing');
    return { id: code.toLowerCase(), username: code };
  },
};
const app = createApp(async () => kv, hashSecret('Maestra-123', 1 << 12), { lichess: fakeLichess });
let ok = 0, bad = 0;
const check = (cond: boolean, msg: string) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };
const call = (method: string, path: string, body: any = {}, auth?: string, ip = '1.1.1.1', user?: string) => {
  const u = new URL('http://x' + path);
  return app({ method, path: u.pathname, query: u.searchParams, auth: auth ? 'Bearer ' + auth : undefined, user, body, ip });
};
const VERIFIER = 'v'.repeat(64);
const login = (code: string, ip = '2.2.2.2') => call('POST', '/api/auth/lichess', { code, verifier: VERIFIER, redirectUri: 'https://traynsko.vercel.app/' }, undefined, ip);

(async () => {
  let r = await call('GET', '/api/worlds'); check(r.status === 200 && (r.body as any).worlds.length === 0, 'empty worlds');
  r = await call('POST', '/api/admin/login', { password: 'nope' }); check(r.status === 401, 'bad master');
  r = await call('POST', '/api/admin/login', { password: 'Maestra-123' }); check(r.status === 200, 'master ok');
  const admin = (r.body as any).token;
  r = await call('POST', '/api/admin/worlds', { name: 'Mundo Benko', password: 'Peon2025', emblem: 'pawn', hue: 30 }, admin); check(r.status === 200, 'create world');
  const wid = (r.body as any).world.id;
  r = await call('POST', '/api/admin/worlds', { name: 'X', password: 'ab' }, admin); check(r.status === 400, 'short pw rejected');
  const lines = parseRepertoire(readFileSync('tests/fixtures/ejemplo.pgn', 'utf8')).lines;
  r = await call('POST', `/api/admin/worlds/${wid}/reps`, { name: 'Blancas', color: 'w', lines }, admin); check(r.status === 200, 'add rep');
  r = await call('POST', `/api/admin/worlds/${wid}/reps`, { name: 'Malo', color: 'w', lines: [{ id: 'x', uci: 'e2e4 hack' }] }, admin); check(r.status === 400, 'bad rep rejected');
  r = await call('GET', '/api/worlds'); check((r.body as any).worlds[0].lineCount === 1, 'public line count');
  check(!JSON.stringify(r.body).includes('Peon2025'), 'public list hides password');
  r = await call('POST', '/api/enter', { world: wid, password: 'mal', name: 'Ana' }); check(r.status === 401, 'wrong world pw');
  r = await call('POST', '/api/enter', { world: wid, password: '  peon2025 ' }); check(r.status === 200, 'world pw case-insensitive');
  const tok = (r.body as any).token;
  r = await call('GET', '/api/content', {}, tok); check(r.status === 200 && (r.body as any).reps[0].lines.length === 1, 'content');
  r = await call('GET', '/api/admin/overview', {}, tok); check(r.status === 403, 'student cannot admin');
  const game = { repId: 'r', repName: 'Blancas', lineId: lines[0].id, lineEvent: 'E', lineWhite: 'W', lineBlack: 'B', userColor: 'w', botId: 'muralla', botName: 'Muralla', botElo: 2300, result: '1-0', termination: 'Jaque mate', timeControl: '600+5', sans: ['d4', 'Nf6'], clocks: [600000, 598000], linePlies: 2, lineErrors: 1 };
  r = await call('POST', '/api/games', { player: 'Ána ', game }, tok); check(r.status === 200, 'save game');
  const gid = (r.body as any).game.id;
  r = await call('POST', '/api/games', { player: 'Luis', game: { ...game, result: '1/2-1/2' } }, tok); check(r.status === 200, 'save game 2');
  r = await call('GET', '/api/games?player=ana', {}, tok); check((r.body as any).games.length === 1, 'own games by normalized name');
  r = await call('GET', `/api/games/${gid}`, {}, tok); check((r.body as any).game.sans.length === 2, 'get full game');
  r = await call('DELETE', `/api/games/${gid}?player=Luis`, {}, tok); check(r.status === 403, 'cannot delete others');
  r = await call('GET', '/api/admin/overview', {}, admin);
  const ow = (r.body as any).worlds[0];
  check(ow.password === 'Peon2025' && ow.gameCount === 2 && ow.players.length === 2, 'overview stats');
  check(ow.players.find((p: any) => p.name === 'Ána').points === 1, 'points');
  r = await call('PATCH', `/api/admin/worlds/${wid}`, { password: 'NuevaClave' }, admin); check(r.status === 200, 'change pw');
  r = await call('GET', '/api/content', {}, tok); check(r.status === 401 && (r.body as any).error === 'password_changed', 'old session invalid after pw change');
  r = await call('POST', '/api/admin/enter', { world: wid }, admin); check(r.status === 200, 'admin enter');
  r = await call('GET', '/api/content', {}, (r.body as any).token); check(r.status === 200, 'admin world token works');
  for (let i = 0; i < 9; i++) await call('POST', '/api/admin/login', { password: 'x' }, undefined, '9.9.9.9');
  r = await call('POST', '/api/admin/login', { password: 'Maestra-123' }, undefined, '9.9.9.9'); check(r.status === 429, 'rate limit admin');
  r = await call('GET', '/api/content', {}, tok.slice(0, -2) + 'xx'); check(r.status === 401, 'tampered token');

  /* ---------- Lichess accounts ---------- */
  const tok2 = (await call('POST', '/api/admin/enter', { world: wid }, admin)).body as any;
  const wt = tok2.token;
  r = await login('bad'); check(r.status === 502, 'lichess rejection is reported');
  r = await call('POST', '/api/auth/lichess', { code: 'x', verifier: 'short', redirectUri: 'https://a.b/' }); check(r.status === 400, 'bad verifier');
  r = await call('POST', '/api/auth/lichess', { code: 'x', verifier: VERIFIER, redirectUri: 'http://evil.com/' }); check(r.status === 400, 'plain http redirect refused');
  r = await login('FrancoGasic'); check(r.status === 200 && (r.body as any).user.name === 'FrancoGasic' && (r.body as any).user.id === 'francogasic', 'login');
  const ut = (r.body as any).token;
  r = await call('GET', '/api/me', {}, undefined, '1.1.1.1', ut); check(r.status === 200 && (r.body as any).user.id === 'francogasic', 'me');
  r = await call('GET', '/api/me', {}, undefined, '1.1.1.1', ut.slice(0, -3) + 'abc'); check(r.status === 401 && (r.body as any).error === 'account_expired', 'tampered user token');
  r = await call('GET', '/api/me', {}, undefined, '1.1.1.1', wt); check(r.status === 401, 'world token is not a user token');
  // games saved with an account ignore the typed name
  r = await call('POST', '/api/games', { player: 'Impostor', game }, wt, '1.1.1.1', ut); check(r.status === 200 && (r.body as any).game.playerName === 'FrancoGasic', 'account game uses lichess name');
  const ag = (r.body as any).game.id;
  r = await call('GET', '/api/games?player=Impostor', {}, wt, '1.1.1.1', ut); check((r.body as any).games.length === 1 && (r.body as any).games[0].id === ag, 'account games listed');
  r = await call('GET', '/api/games?player=lichess:francogasic', {}, wt); check(r.status === 400, 'guest cannot read account games by name');
  r = await call('POST', '/api/games', { player: 'lichess:francogasic', game }, wt); check(r.status === 400, 'guest cannot pose as account');
  r = await call('DELETE', `/api/games/${ag}?player=FrancoGasic`, {}, wt); check(r.status === 403, 'guest cannot delete account game');
  // claim old guest games
  r = await call('POST', '/api/games', { player: 'Franco', game }, wt); check(r.status === 200, 'legacy guest game');
  r = await call('POST', '/api/games', { player: 'franco ', game: { ...game, result: '0-1' } }, wt); check(r.status === 200, 'legacy guest game 2');
  r = await call('GET', '/api/me/claim?name=Franco', {}, wt, '1.1.1.1', ut); check((r.body as any).games === 2 && (r.body as any).claimed === null, 'claim preview');
  r = await call('POST', '/api/me/claim', { name: 'FRANCO' }, wt, '1.1.1.1', ut); check(r.status === 200 && (r.body as any).games === 2, 'claim');
  r = await call('GET', '/api/games', {}, wt, '1.1.1.1', ut); check((r.body as any).games.length === 3, 'claimed games now in account');
  r = await login('Otro', '3.3.3.3'); const ot = (r.body as any).token;
  r = await call('POST', '/api/games', { player: 'Franco', game }, wt); 
  r = await call('POST', '/api/me/claim', { name: 'Franco' }, wt, '1.1.1.1', ot); check(r.status === 409, 'name claimed by another account');
  r = await call('GET', '/api/admin/overview', {}, admin);
  const pl = (r.body as any).worlds[0].players;
  check(pl.some((p: any) => p.name === 'FrancoGasic' && p.games === 3) && pl.some((p: any) => p.name === 'Franco' && p.games === 1), 'stats follow the claim');
  // medals
  const line0 = lines[0];
  const repId = ((await call('GET', '/api/content', {}, wt)).body as any).reps[0].id;
  r = await call('POST', '/api/medals', { repId, lineId: line0.id, startPly: 0, errors: 0, hints: 0 }, wt); check(r.status === 401, 'medal needs account');
  r = await call('POST', '/api/medals', { repId, lineId: line0.id, startPly: 0, errors: 1, hints: 0 }, wt, '1.1.1.1', ut); check(r.status === 400 && (r.body as any).error === 'not_perfect', 'medal needs no errors');
  r = await call('POST', '/api/medals', { repId, lineId: line0.id, startPly: 4, errors: 0, hints: 0 }, wt, '1.1.1.1', ut); check(r.status === 400 && (r.body as any).error === 'not_from_start', 'medal needs move 1');
  r = await call('POST', '/api/medals', { repId, lineId: 'nope', startPly: 0, errors: 0, hints: 0 }, wt, '1.1.1.1', ut); check(r.status === 404, 'medal for unknown line');
  r = await call('POST', '/api/medals', { repId, lineId: line0.id, startPly: 0, errors: 0, hints: 0 }, wt, '1.1.1.1', ut); check(r.status === 200 && (r.body as any).isNew === true, 'medal earned');
  const fp = (r.body as any).medal.fp;
  check(fp === lineFingerprint('w', line0), 'fingerprint shared with the app');
  r = await call('POST', '/api/medals', { repId, lineId: line0.id, startPly: 0, errors: 0, hints: 0 }, wt, '1.1.1.1', ut); check((r.body as any).isNew === false && (r.body as any).medal.count === 2, 'medal revalidated');
  r = await call('GET', '/api/medals', {}, undefined, '1.1.1.1', ut); check((r.body as any).medals.length === 1, 'medals list');
  check(lineFingerprint('w', { uci: 'd2d4 g8f6' }) !== lineFingerprint('b', { uci: 'd2d4 g8f6' }), 'colour is part of the fingerprint');
  check(lineFingerprint('w', { uci: 'd2d4  g8f6 ' }) === lineFingerprint('w', { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', uci: 'd2d4 g8f6' }), 'fingerprint normalises');
  // sign out everywhere, then delete the account
  r = await call('POST', '/api/me/logout-all', {}, undefined, '1.1.1.1', ut); check(r.status === 200, 'logout all');
  r = await call('GET', '/api/me', {}, undefined, '1.1.1.1', ut); check(r.status === 401, 'old token dead after logout-all');
  r = await login('FrancoGasic'); const ut2 = (r.body as any).token;
  r = await call('GET', '/api/medals', {}, undefined, '1.1.1.1', ut2); check((r.body as any).medals.length === 1, 'medals survive a new login');
  r = await call('DELETE', '/api/me', {}, undefined, '1.1.1.1', ut2); check(r.status === 200 && (r.body as any).games === 3, 'delete account');
  r = await call('GET', '/api/me', {}, undefined, '1.1.1.1', ut2); check(r.status === 401, 'deleted account token dead');
  r = await call('GET', '/api/admin/overview', {}, admin);
  check(!(r.body as any).worlds[0].players.some((p: any) => p.name === 'FrancoGasic'), 'account games removed');
  r = await call('POST', '/api/me/claim', { name: 'Franco' }, wt, '1.1.1.1', ot); check(r.status === 200, 'released name can be claimed again');

  r = await call('DELETE', `/api/admin/worlds/${wid}`, {}, admin); check(r.status === 200, 'delete world');
  r = await call('GET', '/api/worlds'); check((r.body as any).worlds.length === 0, 'world gone');
  /* ---------- Lichess client (requests it sends) ---------- */
  const sent: { url: string; method: string; body?: string; auth?: string }[] = [];
  const fakeFetch = (async (url: string, init: any = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body, auth: init.headers?.Authorization });
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b });
    if (url.endsWith('/api/token') && init.method === 'POST') return json(200, { access_token: 'lio_abc', token_type: 'Bearer' });
    if (url.endsWith('/api/account')) return json(200, { id: 'francogasic', username: 'FrancoGasic' });
    return json(204, {});
  }) as any;
  const who = await lichessClient('https://lichess.test', fakeFetch).identify('code1', VERIFIER, 'https://t.app/');
  check(who.username === 'FrancoGasic', 'lichess client identifies');
  const form = new URLSearchParams(sent[0].body);
  check(form.get('grant_type') === 'authorization_code' && form.get('code_verifier') === VERIFIER && form.get('client_id') === 'traynsko' && form.get('redirect_uri') === 'https://t.app/', 'token request form');
  check(sent[1].auth === 'Bearer lio_abc' && sent[2].method === 'DELETE', 'account read then token revoked');

  console.log(`server tests: ${ok} ok, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
