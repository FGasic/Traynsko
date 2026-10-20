import { PIECE_SVG } from '../generated/pieces';
import type { Emblem as EmblemName } from '../../shared/types';

let seq = 0;

/** Heraldic shield in the world's colour with a gold chess piece engraved on it. */
export function Emblem({ emblem, hue, size = 64 }: { emblem: EmblemName; hue: number; size?: number }) {
  const id = `em${++seq}`;
  const shield = 'M10 6 H90 V50 C90 80 72 99 50 110 C28 99 10 80 10 50 Z';
  return (
    <svg class="emblem" width={size} height={size * 1.16} viewBox="0 0 100 116" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={`hsl(${hue} 46% 34%)`} />
          <stop offset="1" stop-color={`hsl(${hue} 55% 12%)`} />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff1c1" />
          <stop offset=".45" stop-color="#e2bd66" />
          <stop offset=".55" stop-color="#a87f2e" />
          <stop offset="1" stop-color="#f0d68e" />
        </linearGradient>
        <radialGradient id={`${id}s`} cx=".5" cy=".3" r=".7">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".18" />
          <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="116">
          <image href={`data:image/svg+xml;base64,${PIECE_SVG[emblem]}`} {...(emblem === 'pawn' ? { x: 14, y: 14, width: 72, height: 72 } : { x: 18, y: 18, width: 64, height: 64 })} />
        </mask>
        <filter id={`${id}d`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#000" flood-opacity=".55" />
        </filter>
      </defs>
      <path d={shield} fill={`url(#${id}f)`} />
      <path d={shield} fill={`url(#${id}s)`} />
      <g filter={`url(#${id}d)`}>
        <rect x="0" y="0" width="100" height="116" fill={`url(#${id}g)`} mask={`url(#${id}m)`} />
      </g>
      <path d={shield} fill="none" stroke={`url(#${id}g)`} stroke-width="4" />
      <path d="M16 11.5 H84 V50 C84 76 68.5 92.5 50 102.5 C31.5 92.5 16 76 16 50 Z" fill="none" stroke="#e2bd66" stroke-opacity=".35" stroke-width="1" />
    </svg>
  );
}

export const EMBLEMS: { id: EmblemName; label: string }[] = [
  { id: 'knight', label: 'Caballo' },
  { id: 'rook', label: 'Torre' },
  { id: 'bishop', label: 'Alfil' },
  { id: 'queen', label: 'Dama' },
  { id: 'king', label: 'Rey' },
  { id: 'pawn', label: 'Peón' },
];

export const HUES = [212, 0, 150, 270, 30, 190, 330, 95];
