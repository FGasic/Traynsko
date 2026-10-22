import { createApp } from '../server/core';
import { memoryKV } from '../server/kv';
import { hashSecret } from '../server/crypto';
import { parseRepertoire } from '../src/lib/pgn';
import { readFileSync } from 'node:fs';
import { lineFingerprint } from '../shared/atlas';
import { lineKey } from '../shared/picks';
import { lichessClient } from '../server/lichess';
import { botAcceptsDraw, botOffersDraw, position } from '../src/lib/draws';

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
  r = await call('POST', '/api/admin/worlds', { name: 'Mundo Benko', password: 'Peon2025', emblem: 'pawn', hue: 30, listed: true }, admin); check(r.status === 200, 'create world');
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
  // key only: the key says which repertoire it opens
  r = await call('POST', '/api/enter', { password: 'PEON2025' }, undefined, '1.1.1.9');
  check(r.status === 200 && (r.body as any).entries.length === 1 && (r.body as any).entries[0].world.id === wid, 'enter with key only');
  r = await call('GET', '/api/content', {}, (r.body as any).entries?.[0]?.token); check(r.status === 200, 'key-only token works');
  r = await call('POST', '/api/enter', { password: 'nada-de-esto' }, undefined, '1.1.1.9'); check(r.status === 401 && (r.body as any).error === 'wrong_password', 'key only: wrong key');
  r = await call('POST', '/api/enter', { password: '' }, undefined, '1.1.1.9'); check(r.status === 400, 'key only: empty key');
  r = await call('POST', '/api/admin/worlds', { name: 'Gemelo', password: 'peon2025', emblem: 'rook', hue: 90 }, admin);
  const twin = (r.body as any).world.id;
  r = await call('POST', '/api/enter', { password: 'peon2025' }, undefined, '1.1.1.9'); check((r.body as any).entries?.length === 2, 'key opening two repertoires returns both');
  await call('PATCH', `/api/admin/worlds/${twin}`, { active: false }, admin);
  r = await call('POST', '/api/enter', { password: 'peon2025' }, undefined, '1.1.1.9'); check((r.body as any).entries?.length === 1, 'hidden repertoire not opened by key');
  await call('DELETE', `/api/admin/worlds/${twin}`, {}, admin);
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

  /* ---------- access per person ---------- */
  {
    const M = (await call('POST', '/api/admin/login', { password: 'Maestra-123' }, undefined, '7.7.7.7')).body as any;
    const adm = M.token;
    r = await call('POST', '/api/admin/worlds', { name: 'Personal de Juan', password: 'juan-1234', emblem: 'rook', hue: 10 }, adm);
    const pw = (r.body as any).world.id;
    r = await call('GET', '/api/worlds'); check(!(r.body as any).worlds.some((w: any) => w.id === pw), 'new repertoire is private: not in the Biblioteca');
    r = await call('POST', '/api/enter', { password: 'juan-1234', name: 'Juan Pérez' }, undefined, '7.7.7.1');
    check(r.status === 200 && (r.body as any).entries[0].world.id === pw, 'private repertoire still opens with its key');
    const jt = (r.body as any).entries[0].token;
    r = await call('GET', '/api/admin/overview', {}, adm);
    let ow = (r.body as any).worlds.find((w: any) => w.id === pw);
    check(ow.members.length === 1 && ow.members[0].id === 'juan perez' && ow.members[0].kind === 'guest' && ow.listed === false, 'entering records the person');
    r = await call('POST', `/api/admin/worlds/${pw}/access`, { member: 'juan perez', blocked: true }, adm); check(r.status === 200 && (r.body as any).member.blocked, 'block one person');
    r = await call('GET', '/api/content', {}, jt); check(r.status === 403 && (r.body as any).error === 'access_blocked', 'blocked person is out at once (same key)');
    r = await call('POST', '/api/enter', { password: 'juan-1234', name: 'juan perez' }, undefined, '7.7.7.1'); check(r.status === 403 && (r.body as any).error === 'access_blocked', 'blocked person cannot enter again');
    r = await call('POST', '/api/enter', { password: 'juan-1234', name: 'Otra Persona' }, undefined, '7.7.7.1'); check(r.status === 200, 'someone else with the same key still enters');
    const other = (r.body as any).entries[0].token;
    r = await call('GET', '/api/content', {}, other); check(r.status === 200, 'the key keeps working for the others');
    // a legacy token (no person inside) is still identified by the name the device sends
    r = await call('POST', '/api/admin/enter', { world: pw }, adm);
    r = await call('GET', '/api/content', {}, (r.body as any).token); check(r.status === 200, 'master is never blocked');
    // account-only: the block can't be dodged with another name
    await call('PATCH', `/api/admin/worlds/${pw}`, { accountOnly: true }, adm);
    r = await call('GET', '/api/content', {}, other); check(r.status === 401 && (r.body as any).error === 'account_required', 'account-only: guests are asked to sign in');
    r = await call('POST', '/api/enter', { password: 'juan-1234', name: 'Nombre Nuevo' }, undefined, '7.7.7.1'); check(r.status === 401 && (r.body as any).error === 'account_required', 'account-only: guest entry refused');
    const jl = (await login('JuanLichess', '7.7.7.2')).body as any;
    r = await call('POST', '/api/enter', { password: 'juan-1234' }, undefined, '7.7.7.2', jl.token); check(r.status === 200, 'account-only: account enters');
    const at = (r.body as any).entries[0].token;
    r = await call('POST', `/api/admin/worlds/${pw}/access`, { member: 'lichess:juanlichess', blocked: true }, adm);
    r = await call('GET', '/api/content', {}, at, '7.7.7.2', jl.token); check(r.status === 403, 'blocked account is out');
    r = await call('POST', '/api/enter', { password: 'juan-1234', name: 'Disfraz' }, undefined, '7.7.7.2'); check(r.status === 401, 'blocked account cannot come back as a guest');
    r = await call('POST', `/api/admin/worlds/${pw}/access`, { member: 'lichess:juanlichess', blocked: false }, adm);
    r = await call('GET', '/api/content', {}, at, '7.7.7.2', jl.token); check(r.status === 200, 'restored account is back in');
    r = await call('GET', '/api/admin/overview', {}, adm);
    ow = (r.body as any).worlds.find((w: any) => w.id === pw);
    check(ow.accountOnly === true && ow.members.find((m: any) => m.id === 'lichess:juanlichess')?.blocked !== true && ow.members.find((m: any) => m.id === 'juan perez')?.blocked === true, 'overview shows access per person');
    await call('PATCH', `/api/admin/worlds/${pw}`, { listed: true }, adm);
    r = await call('GET', '/api/worlds'); check((r.body as any).worlds.some((w: any) => w.id === pw), 'listed repertoire appears in the Biblioteca');
    await call('DELETE', `/api/admin/worlds/${pw}`, {}, adm);
  }

  /* ---------- each person's selection of lines and sets ---------- */
  {
    const adm = ((await call('POST', '/api/admin/login', { password: 'Maestra-123' }, undefined, '8.8.8.0')).body as any).token;
    const pw = ((await call('POST', '/api/admin/worlds', { name: 'Siciliana', password: 'sici-2026' }, adm)).body as any).world.id;
    const sic = parseRepertoire(readFileSync('tests/fixtures/siciliana-negras.pgn', 'utf8')).lines;
    await call('POST', `/api/admin/worlds/${pw}/reps`, { name: 'Negras', color: 'b', lines: sic }, adm);
    const marta = ((await call('POST', '/api/enter', { world: pw, password: 'sici-2026', name: 'Marta' }, undefined, '8.8.8.1')).body as any).token;
    const pedro = ((await call('POST', '/api/enter', { world: pw, password: 'sici-2026', name: 'Pedro' }, undefined, '8.8.8.2')).body as any).token;
    r = await call('GET', '/api/picks', {}, marta); check(r.status === 200 && (r.body as any).picks === null && (r.body as any).synced === true, 'picks: nothing saved yet');
    const k0 = lineKey(sic[0]), k3 = lineKey(sic[3]), k4 = lineKey(sic[4]);
    const mine = { v: 1, off: [k0], sets: [{ id: 'alapin01', name: 'Alapin', lines: [k3, k4], rep: 'RepX1234' }], at: '2026-10-22T10:00:00.000Z' };
    r = await call('PUT', '/api/picks', { picks: mine }, marta); check(r.status === 200 && (r.body as any).synced === true, 'picks: saved');
    r = await call('GET', '/api/picks', {}, marta);
    const got = (r.body as any).picks;
    check(got?.sets[0].name === 'Alapin' && got.sets[0].lines.length === 2 && got.off[0] === k0, 'picks: read back');
    r = await call('GET', '/api/picks', {}, pedro); check((r.body as any).picks === null, 'picks: each person has their own');
    r = await call('PUT', '/api/picks', { picks: { ...mine, sets: [{ id: '!', name: '', lines: [] }] } }, marta); check(r.status === 400, 'picks: invalid refused');
    r = await call('PUT', '/api/picks', { picks: { ...mine, off: Array.from({ length: 7000 }, (_, i) => i.toString(36).padStart(11, 'a')) } }, marta); check(r.status === 400, 'picks: too large refused');
    r = await call('PUT', '/api/picks', { picks: mine }); check(r.status === 401, 'picks: needs a session');
    r = await call('GET', '/api/picks', {}, adm); check(r.status === 400, 'picks: not with the master key');
    const asMaster = ((await call('POST', '/api/admin/enter', { world: pw }, adm)).body as any).token;
    r = await call('PUT', '/api/picks', { picks: mine }, asMaster); check(r.status === 200 && (r.body as any).synced === false, 'picks: master playing, no account: kept on the device');
    const fl = (await login('FrancoPicks', '8.8.8.3')).body as any;
    r = await call('PUT', '/api/picks', { picks: mine }, asMaster, '8.8.8.3', fl.token); check((r.body as any).synced === true, 'picks: master playing with his account: saved');
    const acc = ((await call('POST', '/api/enter', { password: 'sici-2026' }, undefined, '8.8.8.3', fl.token)).body as any).entries[0].token;
    r = await call('GET', '/api/picks', {}, acc, '8.8.8.3', fl.token); check((r.body as any).picks?.sets.length === 1, 'picks: same account, any device');
    r = await call('DELETE', '/api/me', {}, undefined, '8.8.8.3', fl.token); check(r.status === 200, 'picks: account deleted');
    check((await kv.hget('tr:wp:' + pw, 'lichess:francopicks')) === null, 'picks: removed with the account');
    // a person blocked from the repertoire can't read or write theirs
    await call('POST', `/api/admin/worlds/${pw}/access`, { member: 'pedro', blocked: true }, adm);
    r = await call('PUT', '/api/picks', { picks: mine }, pedro); check(r.status === 403, 'picks: blocked person refused');
    await call('DELETE', `/api/admin/worlds/${pw}`, {}, adm);
    check(Object.keys(await kv.hgetall('tr:wp:' + pw)).length === 0, 'picks: removed with the repertoire');
  }

  /* ---------- draws ---------- */
  const ROOKS = '8/5pk1/6p1/8/3R4/6P1/r4PK1/8 w - - 4 60';          // rook ending, equal
  const MIDDLE = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 10';
  const QUIET_MIDDLE = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2QK2R w KQ - 24 30';
  check(position(ROOKS).simplified && !position(MIDDLE).simplified && position(QUIET_MIDDLE).quiet, 'draw: position classes');
  check(botAcceptsDraw({ fen: ROOKS, botEval: 20, freePlies: 40 }), 'draw: equal rook ending accepted');
  check(botAcceptsDraw({ fen: ROOKS, botEval: 70, freePlies: 40 }), 'draw: slightly better rook ending accepted');
  check(!botAcceptsDraw({ fen: ROOKS, botEval: 250, freePlies: 40 }), 'draw: winning ending refused');
  check(!botAcceptsDraw({ fen: MIDDLE, botEval: 0, freePlies: 4 }), 'draw: early equal middlegame refused');
  check(botAcceptsDraw({ fen: MIDDLE, botEval: -120, freePlies: 4 }), 'draw: bot worse accepts early');
  check(botAcceptsDraw({ fen: MIDDLE, botEval: 10, freePlies: 40 }), 'draw: later equal middlegame accepted');
  check(botOffersDraw({ fen: ROOKS, botEval: 5, freePlies: 30, equalStreak: 4, pliesSinceOffer: 999 }), 'draw: bot offers in dead rook ending');
  check(!botOffersDraw({ fen: ROOKS, botEval: 5, freePlies: 30, equalStreak: 2, pliesSinceOffer: 999 }), 'draw: needs a streak');
  check(!botOffersDraw({ fen: ROOKS, botEval: 5, freePlies: 30, equalStreak: 6, pliesSinceOffer: 8 }), 'draw: cooldown after an offer');
  check(!botOffersDraw({ fen: MIDDLE, botEval: 0, freePlies: 10, equalStreak: 6, pliesSinceOffer: 999 }), 'draw: no offer in a live middlegame');
  check(!botOffersDraw({ fen: ROOKS, botEval: 90, freePlies: 30, equalStreak: 6, pliesSinceOffer: 999 }), 'draw: no offer when not equal');

  console.log(`server tests: ${ok} ok, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
