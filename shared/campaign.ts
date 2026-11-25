/**
 * La Campaña: one a day per repertoire. Memory (a Netero of 3 lines), then a whole game against Trayner from
 * the end of one of those lines. It has no points: it is measured by the streak (per account, with truces)
 * and by the Level of the rival (per repertoire, moved by results). Shared by the app and the server.
 */
import { daysBetween, validDay } from './netero';

export const CAMPAIGN = {
  /** lines in the memory phase */
  lines: 3,
  /** the game's time control (fixed, so the Level means the same every day) */
  baseMin: 10,
  incSec: 5,
  /** the rival's Level: where it starts, the first choice offered, its range and its step */
  startDefault: 2000,
  startChoices: [1800, 1900, 2000, 2100, 2200, 2300, 2400],
  min: 1800,
  max: 2800,
  step: 50,
  /** resigning before this move: a loss for the Level, and the day doesn't count for the streak */
  minResignMove: 20,
  /** a truce every 7 days in a row, at most 2 kept */
  truceEvery: 7,
  truceMax: 2,
  historyMax: 120,
};

export type CampaignResult = 'win' | 'draw' | 'loss';

export interface CampaignEntry {
  day: string;
  /** the rival's Level in that game, and the Level after it */
  level: number;
  after: number;
  result: CampaignResult;
  rival: string;
  /** memory phase nota (0–100), when the phase was saved */
  nota: number | null;
  /** counted for the streak (not resigned too early) */
  counted: boolean;
  /** move number when the game ended */
  moves: number;
}

/** One person's Campaign in one repertoire. */
export interface CampaignState {
  level: number;
  start: number;
  max: number;
  lastDay: string;
  history: CampaignEntry[];
}

/** Rewards that stay once earned. */
export type Reward = 'board-campana';

/** The streak, per account. */
export interface Streak {
  cur: number;
  best: number;
  last: string;
  truces: number;
  rewards: Reward[];
}

/** A grandmaster beaten (or held to a draw) in the Campaign. */
export interface RivalCard { name: string; level: number; result: 'win' | 'draw'; date: string; count: number }

export interface CampaignView { campaign: CampaignState | null; streak: Streak; rivals: RivalCard[] }

/** What the app sends when the day's game is over. */
export interface CampaignFinish {
  day: string;
  result: CampaignResult;
  /** move number when it ended, and whether the player resigned */
  moves: number;
  resigned: boolean;
  rival: string;
  nota: number | null;
  /** the starting Level chosen for a first Campaign (ignored afterwards) */
  start?: number;
}

/** What the server answers. */
export interface CampaignOutcome {
  before: number;
  after: number;
  counted: boolean;
  streakCounted: boolean;
  truceEarned: boolean;
  rewardEarned: Reward | null;
  rivalNew: boolean;
}

export const emptyStreak = (): Streak => ({ cur: 0, best: 0, last: '', truces: 0, rewards: [] });

/** Older stored streaks (the daily Netero) had no truces or rewards. */
export const normStreak = (s: Partial<Streak> | null | undefined): Streak => ({ ...emptyStreak(), ...(s ?? {}), truces: s?.truces ?? 0, rewards: s?.rewards ?? [] });

const clampLevel = (n: number) => Math.max(CAMPAIGN.min, Math.min(CAMPAIGN.max, n));

/** The rival's Level after a game: +50 for a win, the same after a draw, −50 for a loss. */
export function nextLevel(level: number, result: CampaignResult): number {
  return clampLevel(level + (result === 'win' ? CAMPAIGN.step : result === 'loss' ? -CAMPAIGN.step : 0));
}

/** Resigned before move 20: a loss for the Level, and no streak that day. */
export const countsForStreak = (f: Pick<CampaignFinish, 'resigned' | 'moves'>) => !(f.resigned && f.moves < CAMPAIGN.minResignMove);

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * The streak as of `today`: days missed since the last Campaign spend truces (one each, the streak goes on but
 * those days don't add); with too few truces, it is broken (the truces are kept, the best streak too).
 */
export function settleStreak(s: Streak, today: string): Streak {
  if (!s.last || !validDay(today)) return s;
  const gap = daysBetween(s.last, today);
  if (gap <= 1) return s;
  const missed = gap - 1;
  if (s.cur > 0 && missed <= s.truces) return { ...s, truces: s.truces - missed, last: addDays(today, -1) };
  return { ...s, cur: 0 };
}

/** A Campaign that counts, completed on `day`. The first one of each day adds to the streak. */
export function bumpCampaignStreak(prev: Streak | null, day: string): { streak: Streak; counted: boolean; truceEarned: boolean; rewardEarned: Reward | null } {
  const s = settleStreak(normStreak(prev), day);
  if (s.last && daysBetween(s.last, day) <= 0) return { streak: s, counted: false, truceEarned: false, rewardEarned: null };
  const cur = s.last && s.cur > 0 && daysBetween(s.last, day) === 1 ? s.cur + 1 : 1;
  const truceEarned = cur % CAMPAIGN.truceEvery === 0 && s.truces < CAMPAIGN.truceMax;
  const rewards = [...s.rewards];
  let rewardEarned: Reward | null = null;
  if (cur >= 7 && !rewards.includes('board-campana')) { rewards.push('board-campana'); rewardEarned = 'board-campana'; }
  return {
    streak: { cur, best: Math.max(s.best, cur), last: day, truces: s.truces + (truceEarned ? 1 : 0), rewards },
    counted: true, truceEarned, rewardEarned,
  };
}

/** For display: the streak today (truces already spent on missed days) and whether today's is done. */
export function streakToday(s: Streak | null, today: string): Streak & { doneToday: boolean; nextTruce: number } {
  const st = settleStreak(normStreak(s), today);
  const doneToday = !!st.last && daysBetween(st.last, today) <= 0;
  // days still needed for the next truce (counting today's Campaign, if not done yet)
  const nextTruce = CAMPAIGN.truceEvery - (st.cur % CAMPAIGN.truceEvery);
  return { ...st, doneToday, nextTruce };
}

/** Add the day's game to the Campaign (creating it with the chosen start on the first day). */
export function applyCampaign(prev: CampaignState | null, f: CampaignFinish): { state: CampaignState; before: number; after: number; counted: boolean } {
  const start = prev ? prev.start : CAMPAIGN.startChoices.includes(f.start ?? -1) ? f.start! : CAMPAIGN.startDefault;
  const before = prev ? prev.level : start;
  const after = nextLevel(before, f.result);
  const counted = countsForStreak(f);
  const entry: CampaignEntry = { day: f.day, level: before, after, result: f.result, rival: f.rival, nota: f.nota, counted, moves: f.moves };
  const history = [...(prev?.history ?? []), entry].slice(-CAMPAIGN.historyMax);
  return {
    state: { level: after, start, max: Math.max(prev?.max ?? start, after), lastDay: f.day, history },
    before, after, counted,
  };
}

/** The collection of rivals: a GM enters with a win or a draw; a win replaces a draw. */
export function addRival(cards: Record<string, RivalCard>, name: string, level: number, result: CampaignResult, date: string): { cards: Record<string, RivalCard>; isNew: boolean } {
  if (result === 'loss') return { cards, isNew: false };
  const prev = cards[name];
  const card: RivalCard = prev
    ? { ...prev, count: prev.count + 1, ...(result === 'win' && (prev.result === 'draw' || level > prev.level) ? { result, level, date } : {}) }
    : { name, level, result, date, count: 1 };
  return { cards: { ...cards, [name]: card }, isNew: !prev };
}

/* ---------------- untrusted input ---------------- */

const RESULTS = new Set<CampaignResult>(['win', 'draw', 'loss']);

export function cleanFinish(raw: unknown): CampaignFinish | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!validDay(r.day) || !RESULTS.has(r.result as CampaignResult)) return null;
  if (typeof r.moves !== 'number' || !Number.isFinite(r.moves) || r.moves < 1 || r.moves > 1000) return null;
  if (typeof r.rival !== 'string' || !r.rival.trim() || r.rival.length > 80) return null;
  const nota = typeof r.nota === 'number' && Number.isFinite(r.nota) && r.nota >= 0 && r.nota <= 100 ? r.nota : null;
  const out: CampaignFinish = { day: r.day as string, result: r.result as CampaignResult, moves: Math.round(r.moves), resigned: r.resigned === true, rival: r.rival.trim(), nota };
  if (typeof r.start === 'number' && CAMPAIGN.startChoices.includes(r.start)) out.start = r.start;
  return out;
}

export const levelLabel = (n: number) => String(Math.round(n));
