/** Types shared by the browser app and the server. */

export interface Line {
  id: string;
  event: string;
  white: string;
  black: string;
  fen?: string;
  uci: string;
}

export interface RepMeta {
  id: string;
  name: string;
  color: 'w' | 'b';
  lineCount: number;
}

export interface Repertoire extends RepMeta {
  lines: Line[];
}

export type Emblem = 'knight' | 'rook' | 'bishop' | 'queen' | 'king' | 'pawn';

/** What anyone can see on the world selection screen. */
export interface PublicWorld {
  id: string;
  name: string;
  subtitle: string;
  emblem: Emblem;
  hue: number;
  repCount: number;
  lineCount: number;
}

export interface PlayerStats {
  name: string;
  games: number;
  points: number;      // 1 per win, 0.5 per draw
  lineErrors: number;  // sum over games
  last: string;        // ISO date of last game
}

export interface AdminWorld extends PublicWorld {
  password: string;
  active: boolean;
  createdAt: string;
  reps: RepMeta[];
  gameCount: number;
  players: PlayerStats[];
}

export interface GameRecord {
  id: string;
  worldId: string;
  worldName: string;
  playerName: string;
  playerKey: string;
  repId: string;
  repName: string;
  lineId: string;
  lineEvent: string;
  lineWhite: string;
  lineBlack: string;
  userColor: 'w' | 'b';
  botId: string;
  botName: string;
  botElo: number;
  result: '1-0' | '0-1' | '1/2-1/2';
  termination: string;
  timeControl: string;
  startFen?: string;
  sans: string[];
  clocks: number[];
  linePlies: number;
  lineErrors: number;
  date: string;
}

export type GameSummary = Omit<GameRecord, 'sans' | 'clocks'> & { plies: number };

export const playerKey = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
