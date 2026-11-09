import { parseInfo, type Candidate } from './bots';

const MULTIPV = 5;

/** A search: its candidates, and every move's score at each depth it was reported. */
export interface Analysis { cands: Candidate[]; byDepth: Map<string, Map<number, number>>; depth: number }

/** WASM build first; the asm.js build is a slower fallback for browsers or hosts that refuse WebAssembly. */
export const ENGINE_FILES = ['stockfish-19-lite-single.js', 'stockfish-19-asm.js'];

/** Stockfish running in a Web Worker on the device. */
export class Engine {
  private worker: Worker | null = null;
  private listeners = new Set<(line: string) => void>();
  ready: Promise<void>;
  failed = false;
  flavor = '';
  private busy: Promise<unknown> = Promise.resolve();

  constructor(files = ENGINE_FILES) {
    this.ready = this.boot(files);
    this.ready.catch(() => { this.failed = true; });
  }

  private async boot(files: string[]) {
    let lastErr: unknown;
    for (const file of files) {
      try {
        await this.start(file, file.includes('asm') ? 45000 : 30000);
        this.flavor = file;
        return;
      } catch (e) {
        lastErr = e;
        this.worker?.terminate();
        this.worker = null;
      }
    }
    throw lastErr ?? new Error('engine unavailable');
  }

  private start(url: string, timeoutMs: number) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('engine timeout')), timeoutMs);
      let w: Worker;
      try { w = new Worker(url); } catch (e) { clearTimeout(timer); reject(e); return; }
      this.worker = w;
      w.onmessage = (ev) => {
        const line = typeof ev.data === 'string' ? ev.data : '';
        if (line === 'readyok') { clearTimeout(timer); resolve(); }
        this.listeners.forEach((fn) => fn(line));
      };
      w.onerror = (ev) => { ev.preventDefault?.(); clearTimeout(timer); reject(new Error('engine error')); };
      w.postMessage('uci');
      w.postMessage(`setoption name MultiPV value ${MULTIPV}`);
      w.postMessage('setoption name Hash value 32');
      w.postMessage('isready');
    });
  }

  private send(cmd: string) { this.worker?.postMessage(cmd); }

  newGame() { this.ready.then(() => this.send('ucinewgame')).catch(() => {}); }

  /** Search a position for `ms` milliseconds and return the MultiPV candidates. */
  async search(fen: string, ms: number): Promise<Candidate[]> {
    return (await this.analyse(fen, ms)).cands;
  }

  /**
   * Like `search`, and also the score of each move at every depth (to tell what is seen early from what
   * only a deep search finds). With `moves`, only those root moves are searched, all of them reported.
   */
  analyse(fen: string, ms: number, moves?: string[]): Promise<Analysis> {
    const only = moves?.length ? [...new Set(moves)] : null;
    const run = async () => {
      await this.ready;
      return new Promise<Analysis>((resolve) => {
        const latest = new Map<number, Candidate & { multipv: number }>();
        const byDepth = new Map<string, Map<number, number>>();
        const onLine = (line: string) => {
          const info = parseInfo(line);
          if (info) {
            const prev = latest.get(info.multipv);
            if (!prev || info.depth >= prev.depth) latest.set(info.multipv, info);
            if (!byDepth.has(info.uci)) byDepth.set(info.uci, new Map());
            byDepth.get(info.uci)!.set(info.depth, info.cp);
          } else if (line.startsWith('bestmove')) {
            this.listeners.delete(onLine);
            if (only) this.send(`setoption name MultiPV value ${MULTIPV}`);
            const best = line.split(' ')[1];
            const cands = [...latest.values()];
            // keep lines from the deepest finished iterations
            const maxDepth = Math.max(0, ...cands.map((c) => c.depth));
            let use = cands.filter((c) => c.depth >= maxDepth - 1);
            if (!use.some((c) => c.uci === best) && best && best !== '(none)') use = [{ uci: best, cp: cands[0]?.cp ?? 0, depth: maxDepth, multipv: 1 }, ...use];
            resolve({ cands: use, byDepth, depth: maxDepth });
          }
        };
        this.listeners.add(onLine);
        if (only) this.send(`setoption name MultiPV value ${Math.min(only.length, 20)}`);
        this.send(`position fen ${fen}`);
        this.send(`go movetime ${Math.max(100, Math.round(ms))}${only ? ' searchmoves ' + only.join(' ') : ''}`);
      });
    };
    const p = this.busy.then(run, run);
    this.busy = p.catch(() => {});
    return p;
  }

  stop() { this.send('stop'); }

  destroy() {
    try { this.send('quit'); } catch { /* ignore */ }
    this.worker?.terminate();
    this.worker = null;
  }
}
