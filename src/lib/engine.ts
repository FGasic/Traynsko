import { parseInfo, type Candidate } from './bots';

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
      w.postMessage('setoption name MultiPV value 5');
      w.postMessage('setoption name Hash value 32');
      w.postMessage('isready');
    });
  }

  private send(cmd: string) { this.worker?.postMessage(cmd); }

  newGame() { this.ready.then(() => this.send('ucinewgame')).catch(() => {}); }

  /** Search a position for `ms` milliseconds and return the MultiPV candidates. */
  search(fen: string, ms: number): Promise<Candidate[]> {
    const run = async () => {
      await this.ready;
      return new Promise<Candidate[]>((resolve) => {
        const latest = new Map<number, Candidate & { multipv: number }>();
        const onLine = (line: string) => {
          const info = parseInfo(line);
          if (info) {
            const prev = latest.get(info.multipv);
            if (!prev || info.depth >= prev.depth) latest.set(info.multipv, info);
          } else if (line.startsWith('bestmove')) {
            this.listeners.delete(onLine);
            const best = line.split(' ')[1];
            const cands = [...latest.values()];
            // keep lines from the deepest finished iterations
            const maxDepth = Math.max(0, ...cands.map((c) => c.depth));
            let use = cands.filter((c) => c.depth >= maxDepth - 1);
            if (!use.some((c) => c.uci === best) && best && best !== '(none)') use = [{ uci: best, cp: cands[0]?.cp ?? 0, depth: maxDepth, multipv: 1 }, ...use];
            resolve(use);
          }
        };
        this.listeners.add(onLine);
        this.send(`position fen ${fen}`);
        this.send(`go movetime ${Math.max(100, Math.round(ms))}`);
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
