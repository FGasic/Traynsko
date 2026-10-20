export type Side = 'w' | 'b';

/** Fischer clock. Starts on the first move of the session; increment added after each move. */
export class ChessClock {
  remaining: Record<Side, number>;
  running: Side | null = null;
  private since = 0;
  started = false;

  constructor(public baseMs: number, public incMs: number) {
    this.remaining = { w: baseMs, b: baseMs };
  }

  private now() { return performance.now(); }

  /** Time left for a side, accounting for the running segment. */
  left(side: Side): number {
    if (this.running === side) return Math.max(0, this.remaining[side] - (this.now() - this.since));
    return this.remaining[side];
  }

  /** Called after `mover` completes a move. Returns time spent (ms). */
  pressAfterMove(mover: Side): number {
    const t = this.now();
    let spent = 0;
    if (this.running === mover) {
      spent = t - this.since;
      this.remaining[mover] = Math.max(0, this.remaining[mover] - spent);
    }
    if (this.started) this.remaining[mover] += this.incMs;
    this.started = true;
    this.running = mover === 'w' ? 'b' : 'w';
    this.since = t;
    return spent;
  }

  stop() {
    if (this.running) {
      this.remaining[this.running] = this.left(this.running);
      this.running = null;
    }
  }

  flagged(): Side | null {
    if (this.running && this.left(this.running) <= 0) return this.running;
    return null;
  }
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 10_000) {
    const s = Math.floor(total / 1000);
    const tenths = Math.floor((total % 1000) / 100);
    return `0:0${s}.${tenths}`;
  }
  const secs = Math.ceil(total / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** PGN %clk value (h:mm:ss). */
export function fmtClk(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
