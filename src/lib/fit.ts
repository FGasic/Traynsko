import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Board size from the space that is really available on the training screen.
 * Viewport units can't be trusted for this: each mobile browser counts its own toolbars differently
 * (Chrome's top bar, Brave's and Samsung's bottom bars, Safari's floating bar), so on some phones the
 * controls below the board ended up behind the tab bar. Here we measure the screen and its parts instead.
 * CSS declares the layout in `--layout` (wide | stacked | side) and the limits in `--board-max/-min`;
 * the result is written to `--board`, which the grid uses. The CSS value stays as the first-paint fallback.
 */
export function fitBoard(el: HTMLElement) {
  const area = el.querySelector('.board-area') as HTMLElement | null;
  const col = el.querySelector('.board-col') as HTMLElement | null;
  const side = el.querySelector('.side-col') as HTMLElement | null;
  if (!area || !col) return;
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const W = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  const H = el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
  if (W < 60 || H < 60) return;                                   // not laid out yet
  const mode = cs.getPropertyValue('--layout').trim() || 'wide';
  const max = px(cs.getPropertyValue('--board-max')) || 780;
  const min = Math.min(W, px(cs.getPropertyValue('--board-min')) || 200);
  const board = area.getBoundingClientRect().height;
  const around = col.getBoundingClientRect().height - board;       // player strips and gaps above/below the board
  let b: number;
  if (mode === 'stacked') {
    const below = side ? Math.max(side.getBoundingClientRect().height, side.scrollHeight) : 0;
    b = Math.min(W, H - around - px(cs.rowGap) - below);
  } else if (mode === 'side') {
    b = Math.min(H, W - px(cs.columnGap) - (px(cs.getPropertyValue('--side-min')) || 240));
  } else {
    b = Math.min(H - around, W - px(cs.columnGap) - (side ? side.getBoundingClientRect().width : 340));
  }
  // chessground draws the board in whole multiples of 8 device pixels: use exactly that size so the board,
  // its frame and the player strips share the same edges
  const dpr = window.devicePixelRatio || 1;
  b = Math.floor((Math.max(min, Math.min(max, b)) * dpr) / 8) * 8 / dpr;
  b = Math.round(b * 1000) / 1000;
  if (Math.abs(px(el.style.getPropertyValue('--board')) - b) > 0.01) el.style.setProperty('--board', `${b}px`);
  // stacked: strips and panel share the board's edges, unless the height made the board clearly narrower than the screen
  const panel = mode === 'stacked' && W - b > 32 ? Math.max(b, Math.min(W, 440)) : b;
  if (Math.abs(px(el.style.getPropertyValue('--panel')) - panel) > 0.01) el.style.setProperty('--panel', `${panel}px`);
}

/** Keeps `--board` fitted while the screen, the browser bars, the fonts or the panel under the board change. */
export function useBoardFit(ref: RefObject<HTMLElement>) {
  const st = useRef<{ el: HTMLElement | null; side: Element | null; ro: ResizeObserver | null; raf: number; off?: () => void }>({ el: null, side: null, ro: null, raf: 0 });

  useEffect(() => {
    const s = st.current;
    const el = ref.current;
    const run = () => { s.raf = 0; if (s.el) fitBoard(s.el); };
    const soon = () => { if (!s.raf) s.raf = requestAnimationFrame(run); };
    if (el !== s.el) {
      s.off?.();
      s.el = el;
      s.side = null;
      if (!el) return;
      s.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(soon) : null;
      s.ro?.observe(el);
      const vv = window.visualViewport;
      window.addEventListener('resize', soon);
      window.addEventListener('orientationchange', soon);
      vv?.addEventListener('resize', soon);
      (document as any).fonts?.ready?.then(soon).catch(() => {});
      s.off = () => {
        s.ro?.disconnect();
        window.removeEventListener('resize', soon);
        window.removeEventListener('orientationchange', soon);
        vv?.removeEventListener('resize', soon);
        if (s.raf) cancelAnimationFrame(s.raf);
        s.raf = 0;
      };
    }
    // the panel under the board appears after the first render and changes with the phase of the game
    const side = el?.querySelector('.side-col') ?? null;
    if (side && side !== s.side) { if (s.side) s.ro?.unobserve(s.side); s.ro?.observe(side); s.side = side; }
    soon();
  });

  useEffect(() => () => { st.current.off?.(); st.current.el = null; }, []);
}
