/**
 * La Campaña on this device: where today's Campaign stands, kept after every step so it can be carried on
 * after closing the app. The rules (Level, streak, truces) live in shared/campaign.ts; the server keeps the result.
 */
import type { CampaignOutcome, CampaignResult } from '../../shared/campaign';
import { daysBetween } from '../../shared/netero';
import type { GameSnap } from './session';

export type CampaignPhase = 'memory' | 'game' | 'saving' | 'done';

export interface CampaignLocal {
  v: 1;
  worldId: string;
  /** the local day it was started: it counts for that day even if it ends after midnight */
  day: string;
  phase: CampaignPhase;
  /** the 3 lines of the memory phase (line keys) */
  lines: string[];
  /** memory phase: nota and fails, once it is over */
  nota: number | null;
  fails: number;
  /** the line the game starts from, its rival and the rival's Level */
  gameLine: string | null;
  rival: string;
  level: number;
  /** the starting Level chosen for a first Campaign */
  start?: number;
  /** the game in progress */
  game?: GameSnap;
  /** the game is over: what to send (kept until the server has it) */
  finish?: { result: CampaignResult; moves: number; resigned: boolean };
  /** the server's answer */
  outcome?: CampaignOutcome;
}

/** A Campaign kept on the device is still playable if it started today or yesterday (the server allows one day). */
export function liveCampaign(c: CampaignLocal | null, worldId: string, today: string): CampaignLocal | null {
  if (!c || c.v !== 1 || c.worldId !== worldId) return null;
  const age = daysBetween(c.day, today);
  if (age < 0 || age > 1) return null;
  if (c.phase === 'done' && age > 0) return null;
  return c;
}
