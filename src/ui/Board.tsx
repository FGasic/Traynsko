import { useEffect, useRef } from 'preact/hooks';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';

interface Props {
  theme: string;
  coords: boolean;
  onReady(api: Api): void;
  config: Config;
  flash?: number; // increments to trigger the "wrong move" shake
}

export function Board({ theme, coords, onReady, config, flash }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const shell = useRef<HTMLDivElement>(null);

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
    return () => { api.current?.destroy(); api.current = null; };
  }, []);

  const firstCoords = useRef(true);
  useEffect(() => {
    if (firstCoords.current) { firstCoords.current = false; return; }
    api.current?.set({ coordinates: coords });
    api.current?.redrawAll();
  }, [coords]);

  useEffect(() => {
    if (!flash || !shell.current) return;
    const s = shell.current;
    s.classList.remove('shake');
    void s.offsetWidth;
    s.classList.add('shake');
  }, [flash]);

  return (
    <div ref={shell} class={`board-shell theme-${theme}`}>
      <div ref={el} class="cg-wrap" />
    </div>
  );
}
