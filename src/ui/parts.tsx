import type { ComponentChildren } from 'preact';
import type { Bot } from '../lib/bots';

export type IconName = 'train' | 'book' | 'bot' | 'archive' | 'sliders' | 'upload' | 'drive' | 'download' | 'copy' | 'trash' | 'next' | 'flag' | 'skip' | 'eye' | 'check' | 'x' | 'refresh' | 'chevron' | 'edit';

const PATHS: Record<IconName, string> = {
  train: 'M4 4h16v16H4z M4 12h16 M12 4v16 M4 4l8 8 M12 12l8 8',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11 M9 8h6',
  bot: 'M7 8h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z M12 4v4 M9.5 13h.01 M14.5 13h.01 M10 16h4',
  archive: 'M4 5h16v4H4z M5 9v10h14V9 M10 13h4',
  sliders: 'M5 6h9 M18 6h1 M5 12h3 M12 12h7 M5 18h11 M20 18h-1 M16 4v4 M10 10v4 M18 16v4',
  upload: 'M12 16V4 M7 9l5-5 5 5 M5 20h14',
  drive: 'M8.5 4h7l5.5 9.5-3.5 6h-11L3 13.5z M8.5 4l5.5 9.5 M3 13.5h11 M15.5 4L10 13.5',
  download: 'M12 4v12 M7 11l5 5 5-5 M5 20h14',
  copy: 'M9 9h10v11H9z M5 15V4h10',
  trash: 'M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13',
  next: 'M5 12h14 M13 6l6 6-6 6',
  flag: 'M6 21V4 M6 4h11l-2 4 2 4H6',
  skip: 'M5 5l9 7-9 7z M18 5v14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12 M18 6L6 18',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  chevron: 'M9 6l6 6-6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

const GLYPHS: Record<Bot['glyph'], ComponentChildren> = {
  tower: <path d="M9 9h2v1.6h2V9h2v1.6h2V9h2v4l-2 1.5V20h-8v-5.5L9 13z" />,
  bolt: <path d="M15.5 6 9 15h4.5l-1.5 7 6.5-9h-4.5z" />,
  grid: <g><rect x="8" y="8" width="4" height="4" /><rect x="16" y="8" width="4" height="4" /><rect x="12" y="12" width="4" height="4" /><rect x="8" y="16" width="4" height="4" /><rect x="16" y="16" width="4" height="4" /></g>,
  scale: <path d="M14 7v13 M10 20h8 M8 10h12 M8 10l-2.5 5h5z M20 10l-2.5 5h5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />,
  blade: <path d="M20.5 7.5 11 17l-1.8-1.8 9.5-9.5h1.8z M9 15l4 4-1.4 1.4-1.3-1.3L8.5 21 7 19.5l1.9-1.8-1.3-1.3z" />,
  dice: <g><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6" /><circle cx="11" cy="11" r="1.3" /><circle cx="14" cy="14" r="1.3" /><circle cx="17" cy="17" r="1.3" /></g>,
  gear: <path d="M14 9.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6zm0 2.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M13 6h2v2.6h-2z M13 19.4h2V22h-2z M6 13h2.6v2H6z M19.4 13H22v2h-2.6z" />,
};

export function BotAvatar({ bot, size = 40, hidden = false }: { bot?: Bot; size?: number; hidden?: boolean }) {
  if (!bot || hidden) {
    return (
      <svg class="avatar" width={size} height={size} viewBox="0 0 28 28" aria-label="Rival oculto">
        <rect width="28" height="28" rx="8" fill="var(--avatar-hidden-bg)" />
        <text x="14" y="19" text-anchor="middle" font-size="14" font-weight="700" fill="var(--fg-mute)" font-family="var(--font-display)">?</text>
      </svg>
    );
  }
  return (
    <svg class="avatar" width={size} height={size} viewBox="0 0 28 28" aria-label={bot.name} style={{ color: `hsl(${bot.hue} 70% 78%)` }}>
      <rect width="28" height="28" rx="8" fill={`hsl(${bot.hue} 32% 24%)`} />
      <g fill="currentColor" transform="translate(-0 -0)">{GLYPHS[bot.glyph]}</g>
    </svg>
  );
}

export function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} class={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span class="knob" />
    </button>
  );
}

export function Segmented<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div id={id} class="segmented" role="radiogroup">
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o.value === value} class={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PieceDot({ color }: { color: 'w' | 'b' }) {
  return <span class={`piece-dot ${color === 'w' ? 'white' : 'black'}`} aria-label={color === 'w' ? 'Blancas' : 'Negras'} />;
}
