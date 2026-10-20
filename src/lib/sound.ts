// Board sounds: real wooden knocks (Kenney, CC0) decoded once into Web Audio buffers.
// Short notification chimes (line completed, game over) are generated as soft bells.
import { SOUNDS } from '../sounds-data';

type Sample = 'move' | 'capture' | 'castle' | 'wrong';

let ctx: AudioContext | null = null;
let enabled = true;
const buffers = new Map<string, AudioBuffer>();
let loading: Promise<void> | null = null;

export function setSoundEnabled(on: boolean) { enabled = on; }

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

function decode(c: AudioContext, b64: string): Promise<AudioBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Promise((resolve, reject) => {
    const p = c.decodeAudioData(bytes.buffer, resolve, reject);
    if (p && typeof (p as any).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

function load(c: AudioContext) {
  if (!loading) {
    loading = Promise.all(Object.entries(SOUNDS).map(async ([k, b64]) => {
      try { buffers.set(k, await decode(c, b64)); } catch { /* that sound stays silent */ }
    })).then(() => {});
  }
  return loading;
}

/** Call from the first user gesture so the first move already has sound. */
export function primeSound() {
  const c = ac();
  if (c) load(c);
}

function sample(name: Sample, gain = 1, delay = 0) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const buf = buffers.get(name);
  if (!buf) { load(c); return; }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(c.destination);
  src.start(c.currentTime + delay);
}

function bell(freq: number, delay: number, gain: number, dur = 0.9) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  // fundamental + two inharmonic partials, like a small desk bell
  [[1, 1], [2.76, 0.32], [5.4, 0.12]].forEach(([mul, amp]) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * mul, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / mul);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

export const sound = {
  move() { sample('move'); },
  capture() { sample('capture'); },
  castle() { sample('castle'); },
  check() { sample('move'); bell(1320, 0.03, 0.05, 0.5); },
  wrong() { sample('wrong', 0.9); },
  phase() { bell(784, 0, 0.07); bell(1175, 0.14, 0.06); },
  end() { bell(659, 0, 0.07, 1.2); bell(988, 0.18, 0.06, 1.2); },
  preview() { sample('move'); sample('capture', 1, 0.45); sample('castle', 1, 0.9); },
};
