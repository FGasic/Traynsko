// La Campaña: Level, streak with truces, rewards, rivals (shared), the saved game (session), and the server.
import { readFileSync } from 'node:fs';
import {
  CAMPAIGN, addDays, addRival, applyCampaign, bumpCampaignStreak, cleanFinish, countsForStreak, nextLevel, settleStreak, streakToday,
  type Streak,
} from '../shared/campaign';
import { Session } from '../src/lib/session';
import { BOTS } from '../src/lib/bots';
import type { Line } from '../shared/types';
import { createApp } from '../server/core';
import { memoryKV } from '../server/kv';
import { hashSecret } from '../server/crypto';

let ok = 0, bad = 0;
const check = (cond: boolean, msg: string) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };
const S = (o: Partial<Streak>): Streak => ({ cur: 0, best: 0, last: '', truces: 0, rewards: [], ...o });

(async () => {
  /* ---------- the rival's Level ---------- */
  check(nextLevel(2000, 'win') === 2050 && nextLevel(2000, 'draw') === 2000 && nextLevel(2000, 'loss') === 1950, 'Level: +50 / 0 / −50');
  check(nextLevel(1800, 'loss') === 1800 && nextLevel(2800, 'win') === 2800, 'Level: kept between 1800 and 2800');
  check(!countsForStreak({ resigned: true, moves: 19 }) && countsForStreak({ resigned: true, moves: 20 }) && countsForStreak({ resigned: false, moves: 8 }), 'resigning before move 20 does not count; a short finished game does');

  let c = applyCampaign(null, { day: '2026-11-25', result: 'win', moves: 40, resigned: false, rival: 'GM A', nota: 90, start: 2200 });
  check(c.before === 2200 && c.after === 2250 && c.state.start === 2200 && c.state.max === 2250 && c.counted, 'first Campaign: chosen start, then +50');
  c = applyCampaign(c.state, { day: '2026-11-26', result: 'loss', moves: 12, resigned: true, rival: 'GM B', nota: 60, start: 1800 });
  check(c.before === 2250 && c.after === 2200 && c.state.start === 2200 && c.state.max === 2250 && !c.counted, 'later: the start cannot change; an early resignation is a loss and does not count');
  check(c.state.history.length === 2 && c.state.lastDay === '2026-11-26', 'history kept');
  check(applyCampaign(null, { day: '2026-11-25', result: 'draw', moves: 30, resigned: false, rival: 'GM', nota: null, start: 2050 }).before === CAMPAIGN.startDefault, 'a start that is not offered falls back to 2000');

  /* ---------- the streak and its truces ---------- */
  let r = bumpCampaignStreak(null, '2026-11-01');
  check(r.counted && r.streak.cur === 1 && r.streak.truces === 0, 'first Campaign starts the streak');
  check(!bumpCampaignStreak(r.streak, '2026-11-01').counted, 'a second one the same day does not count');
  let st = r.streak;
  for (let d = 2; d <= 7; d++) st = bumpCampaignStreak(st, `2026-11-0${d}`).streak;
  check(st.cur === 7 && st.truces === 1 && st.rewards.includes('board-campana'), 'day 7: a truce and the Campaign board');
  r = bumpCampaignStreak(st, '2026-11-09');           // the 8th was missed: one truce covers it
  check(r.counted && r.streak.cur === 8 && r.streak.truces === 0, 'one missed day: the truce is spent, the streak goes on (the covered day does not add)');
  st = r.streak;
  r = bumpCampaignStreak(st, '2026-11-11');           // the 10th missed, no truce left
  check(r.streak.cur === 1 && r.streak.best === 8 && !r.rewardEarned, 'no truce: the streak starts again, the best is kept, the reward is not given twice');
  // two truces cover two days, never three
  st = S({ cur: 20, best: 20, last: '2026-11-20', truces: 2, rewards: ['board-campana'] });
  check(bumpCampaignStreak(st, '2026-11-23').streak.cur === 21, 'two missed days, two truces: the streak goes on');
  check(bumpCampaignStreak(st, '2026-11-24').streak.cur === 1, 'three missed days with two truces: broken');
  check(settleStreak(st, '2026-11-22').truces === 1, 'settling spends one truce per missed day');
  check(bumpCampaignStreak(S({ cur: 13, best: 13, last: '2026-11-20', truces: 2 }), '2026-11-21').streak.truces === 2, 'never more than 2 truces');
  let today = streakToday(S({ cur: 5, best: 9, last: '2026-11-24', truces: 1 }), '2026-11-25');
  check(today.cur === 5 && !today.doneToday && today.nextTruce === 2, 'today: alive, pending, 2 days to the next truce');
  today = streakToday(S({ cur: 5, best: 9, last: '2026-11-22', truces: 1 }), '2026-11-25');
  check(today.cur === 0 && today.truces === 1, 'today: two days missed with one truce → broken (shown as 0)');
  check(addDays('2026-12-31', 1) === '2027-01-01' && addDays('2026-03-01', -1) === '2026-02-28', 'days across months and years');
  check(bumpCampaignStreak(S({ cur: 3, best: 3, last: '2026-12-31' }), '2027-01-01').streak.cur === 4, 'streak across the new year');

  /* ---------- the collection of rivals ---------- */
  let col = addRival({}, 'GM A', 2000, 'draw', '2026-11-01');
  check(col.isNew && col.cards['GM A'].result === 'draw', 'a draw enters the collection');
  col = addRival(col.cards, 'GM A', 2050, 'win', '2026-11-02');
  check(!col.isNew && col.cards['GM A'].result === 'win' && col.cards['GM A'].count === 2, 'a later win replaces the draw');
  check(addRival(col.cards, 'GM B', 2000, 'loss', 'x').cards['GM B'] === undefined, 'a loss does not enter');

  /* ---------- untrusted input ---------- */
  const good = { day: '2026-11-25', result: 'win', moves: 33, resigned: false, rival: 'GM X', nota: 88 };
  check(!!cleanFinish(good) && cleanFinish({ ...good, start: 2100 })!.start === 2100, 'a real finish is accepted');
  check(cleanFinish({ ...good, result: 'mate' }) === null && cleanFinish({ ...good, day: 'ayer' }) === null && cleanFinish({ ...good, rival: '' }) === null, 'bad finishes refused');
  check(cleanFinish({ ...good, start: 2150 })!.start === undefined && cleanFinish({ ...good, nota: 300 })!.nota === null, 'odd values dropped');

  /* ---------- the game is saved and carried on ---------- */
  const line: Line = { id: 'b1', event: 'Benko', white: 'Benko', black: '', uci: 'd2d4 g8f6 c2c4 c7c5 d4d5 b7b5' };
  const ev = { change() {}, move() {}, wrong() {}, phase() {}, end() {}, engineError() {}, draw() {} };
  const cfg = { line, userColor: 'b' as const, bot: BOTS[0], elo: 2000, baseMs: 600_000, incMs: 5000, botMoveMs: 1000, startMove: 1, preplayLine: true };
  const g1 = new Session(cfg, null, ev);
  check(g1.lineIdx === 6 && g1.chess.history().length === 6 && g1.preplied === 6, 'the whole line is on the board: the game starts where it ends');
  // the game goes on: 7.cxb5 a6 (bot, then player)
  (g1 as any).apply('c4b5', 'bot');
  (g1 as any).apply('a7a6', 'user');
  const snap = JSON.parse(JSON.stringify(g1.snapshot()));
  check(snap.moves.length === 2 && snap.moves[0].uci === 'c4b5' && snap.moves[1].by === 'user', 'snapshot: only the moves after the line');
  snap.remaining = { w: 512_000, b: 487_000 };
  const g2 = new Session(cfg, null, ev);
  g2.restore(snap);
  check(g2.chess.fen() === g1.chess.fen() && g2.played.length === 8, 'restored: same position, same moves');
  check(g2.clock.left('b') === 487_000 && Math.abs(g2.clock.left('w') - 512_000) < 50 && g2.clock.running === 'w', 'restored: both clocks as they were, the side to move running');
  const pgn = g2.played.map((m) => m.by).join();
  check(pgn === 'pre,pre,pre,pre,pre,pre,bot,user', 'restored: the record keeps the line and the game');
  g1.destroy(); g2.destroy();

  /* ---------- server ---------- */
  const kv = memoryKV();
  const app = createApp(async () => kv, hashSecret('Maestra-123', 1 << 12), { lichess: { identify: async (code: string) => ({ id: code.toLowerCase(), username: code }) } });
  const call = (method: string, path: string, body: any = {}, auth?: string, user?: string, ip = '6.6.6.6') => {
    const u = new URL('http://x' + path);
    return app({ method, path: u.pathname, query: u.searchParams, auth: auth ? 'Bearer ' + auth : undefined, user, body, ip });
  };
  const admin = ((await call('POST', '/api/admin/login', { password: 'Maestra-123' })).body as any).token;
  const benko: Line[] = JSON.parse(readFileSync('tests/fixtures/benko-negras.json', 'utf8'));
  const mk = async (name: string, key: string) => {
    const id = ((await call('POST', '/api/admin/worlds', { name, password: key }, admin)).body as any).world.id;
    await call('POST', `/api/admin/worlds/${id}/reps`, { name: 'Benko Principal', color: 'b', lines: benko }, admin);
    return id;
  };
  const w1 = await mk('Benko', 'benko-camp'), w2 = await mk('Benko 2', 'benko-camp2');
  const ut = ((await call('POST', '/api/auth/lichess', { code: 'Camp', verifier: 'v'.repeat(64), redirectUri: 'https://traynsko.vercel.app/' })).body as any).token;
  const t1 = ((await call('POST', '/api/enter', { password: 'benko-camp' }, undefined, ut)).body as any).entries[0].token;
  const t2 = ((await call('POST', '/api/enter', { password: 'benko-camp2' }, undefined, ut)).body as any).entries[0].token;
  const guest = ((await call('POST', '/api/enter', { password: 'benko-camp', name: 'Invitado' })).body as any).entries[0].token;
  const day = new Date().toISOString().slice(0, 10);

  let res = await call('GET', '/api/campaign', {}, guest);
  check(res.status === 401, 'campaign: needs an account');
  res = await call('GET', '/api/campaign', {}, t1, ut);
  check(res.status === 200 && (res.body as any).campaign === null && (res.body as any).streak.cur === 0 && (res.body as any).rivals.length === 0, 'campaign: empty at first');
  res = await call('POST', '/api/campaign', { finish: { day, result: 'win', moves: 41, resigned: false, rival: 'GM J.K. Duda', nota: 92, start: 2100 } }, t1, ut);
  let b = res.body as any;
  check(res.status === 200 && b.outcome.before === 2100 && b.outcome.after === 2150 && b.campaign.level === 2150, 'campaign: first game from the chosen start');
  check(b.outcome.streakCounted && b.streak.cur === 1 && b.outcome.rivalNew && b.rivals[0].name === 'GM J.K. Duda', 'campaign: streak and the rival collected');
  res = await call('POST', '/api/campaign', { finish: { day, result: 'win', moves: 41, resigned: false, rival: 'GM Otro', nota: 92 } }, t1, ut);
  check(res.status === 409 && (res.body as any).error === 'campaign_done', 'campaign: one a day per repertoire');
  // another repertoire the same day: its own Level, the streak (per account) does not count twice
  res = await call('POST', '/api/campaign', { finish: { day, result: 'loss', moves: 15, resigned: true, rival: 'GM Z', nota: 40 } }, t2, ut);
  b = res.body as any;
  check(res.status === 200 && b.outcome.before === 2000 && b.outcome.after === 1950 && !b.outcome.counted && !b.outcome.streakCounted, 'campaign: another repertoire, its own Level; early resignation: no streak');
  check(b.streak.cur === 1 && b.rivals.length === 1, 'campaign: the streak stays per account; a loss collects no rival');
  res = await call('POST', '/api/campaign', { finish: { day: '2020-01-01', result: 'win', moves: 40, resigned: false, rival: 'GM', nota: 1 } }, t1, ut);
  check(res.status === 400, 'campaign: a date far from today is refused');
  res = await call('POST', '/api/campaign', { finish: { day, result: 'win' } }, t1, ut);
  check(res.status === 400, 'campaign: invalid finish refused');
  // a Campaign game is saved in the registry, marked
  const game = { repId: 'r', repName: 'Benko', lineId: benko[0].id, lineEvent: 'E', lineWhite: 'W', lineBlack: 'B', userColor: 'b', botId: 'trayner', botName: 'GM J.K. Duda', botElo: 2100, result: '0-1', termination: 'Jaque mate', timeControl: '600+5', sans: ['d4', 'Nf6'], clocks: [600000, 598000], linePlies: 2, lineErrors: 0, mode: 'campaign' };
  res = await call('POST', '/api/games', { player: 'x', game }, t1, ut);
  check(res.status === 200 && (res.body as any).game.mode === 'campaign', 'campaign: the game is saved, marked as Campaign');
  // deleting the account deletes the Campaign, the streak and the rivals
  await call('DELETE', '/api/me', {}, undefined, ut);
  check((await kv.get(`tr:cp:${w1}:camp`)) === null && (await kv.get(`tr:cp:${w2}:camp`)) === null && (await kv.get('tr:ns:camp')) === null && (await kv.get('tr:nc:camp')) === null, 'campaign: removed with the account');
  // deleting a repertoire deletes its Campaigns
  const ut2 = ((await call('POST', '/api/auth/lichess', { code: 'Otro', verifier: 'v'.repeat(64), redirectUri: 'https://traynsko.vercel.app/' })).body as any).token;
  const t3 = ((await call('POST', '/api/enter', { password: 'benko-camp' }, undefined, ut2)).body as any).entries[0].token;
  await call('POST', '/api/campaign', { finish: { day, result: 'draw', moves: 50, resigned: false, rival: 'GM Q', nota: 70 } }, t3, ut2);
  check(!!(await kv.get(`tr:cp:${w1}:otro`)), 'campaign: saved for another account');
  await call('DELETE', `/api/admin/worlds/${w1}`, {}, admin);
  check((await kv.get(`tr:cp:${w1}:otro`)) === null && !!(await kv.get('tr:ns:otro')), 'campaign: removed with the repertoire (the streak, per account, stays)');

  console.log(`campaign: ${ok} ok, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
