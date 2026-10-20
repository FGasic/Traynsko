import { useEffect, useRef } from 'preact/hooks';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';

interface Props {
  theme: string;
  coords: boolean;
  onReady(api: Api): void;
  config: Config;
  flash?: number;   // increments to signal a wrong move
  active?: boolean; // false while the board sits behind another screen
}

/**
 * Chessground board with a self-healing layout guard.
 * Chessground caches the board's size to place pieces; if the size changes while it isn't looking
 * (hidden screen, zoom, window snapping, late font load), pieces drift off their squares.
 * We compare the cached size with the real one and re-render whenever they disagree.
 */
export function Board({ theme, coords, onReady, config, flash, active = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const shell = useRef<HTMLDivElement>(null);

  const heal = (force = false) => {
    if ((window as any).__traynskoNoHeal) return;
    const a = api.current, wrap = el.current;
    if (!a || !wrap) return;
    const w = wrap.getBoundingClientRect();
    if (w.width < 16 || w.height < 16) return;                    // not laid out: nothing to fix yet
    const st: any = a.state;
    if (st.draggable?.current || st.animation?.current) return;     // never interrupt a drag or an animation
    const board = wrap.querySelector('cg-board') as HTMLElement | null;
    if (!board) return;
    const real = board.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const expected = Math.floor((w.width * dpr) / 8) * 8 / dpr;
    let cached = real.width;
    try { cached = st.dom.bounds().width; } catch { /* ignore */ }
    let off = Math.abs(real.width - expected) > 0.75 || Math.abs(cached - real.width) > 0.5 || Math.abs(real.height - real.width) > 0.75;
    if (!off) {
      // every piece must sit exactly on its square
      const white = st.orientation === 'white';
      const unit = real.width / 8;
      for (const p of board.querySelectorAll('piece')) {
        const pe = p as any;
        if (!pe.cgKey || pe.cgAnimating || p.classList.contains('ghost') || p.classList.contains('fading')) continue;
        const f = pe.cgKey.charCodeAt(0) - 97, r = pe.cgKey.charCodeAt(1) - 49;
        const ex = (white ? f : 7 - f) * unit, ey = (white ? 7 - r : r) * unit;
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((p as HTMLElement).style.transform);
        if (!m || Math.abs(Number(m[1]) - ex) > 1 || Math.abs(Number(m[2]) - ey) > 1) { off = true; break; }
      }
    }
    if (force || off) a.redrawAll();
  };

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: coords,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      draggable: { enabled: true, showGhost: true },
      premovable: { enabled: false },
      drawable: { enabled: true, visible: true },
      disableContextMenu: true,
      ...config,
    });
    onReady(api.current);

    const soon = () => requestAnimationFrame(() => heal());
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(soon) : null;
    ro?.observe(el.current);
    window.addEventListener('resize', soon);
    window.addEventListener('orientationchange', soon);
    document.addEventListener('visibilitychange', soon);
    (document as any).fonts?.ready?.then(soon).catch(() => {});
    const timer = setInterval(() => heal(), 800);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', soon);
      window.removeEventListener('orientationchange', soon);
      document.removeEventListener('visibilitychange', soon);
      clearInterval(timer);
      api.current?.destroy();
      api.current = null;
    };
  }, []);

  // coming back to the board: rebuild it from state so it is always exact
  useEffect(() => {
    if (active) requestAnimationFrame(() => heal(true));
  }, [active]);

  const firstCoords = useRef(true);
  useEffect(() => {
    if (firstCoords.current) { firstCoords.current = false; return; }
    api.current?.set({ coordinates: coords });
    api.current?.redrawAll();
  }, [coords]);

  // wrong move: a red glow on the frame (no movement, so the board geometry never changes)
  useEffect(() => {
    if (!flash || !shell.current) return;
    const s = shell.current;
    s.classList.remove('flash-wrong');
    void s.offsetWidth;
    s.classList.add('flash-wrong');
  }, [flash]);

  return (
    <div ref={shell} class={`board-shell theme-${theme}`}>
      <div ref={el} class="cg-wrap" />
    </div>
  );
}
