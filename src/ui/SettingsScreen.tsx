import { useState } from 'preact/hooks';
import { Segmented, Toggle } from './parts';
import { sound } from '../lib/sound';
import type { Settings } from '../lib/prefs';
import type { PublicWorld } from '../../shared/types';
import { Emblem } from './Emblem';

const PRESETS: [number, number][] = [[3, 2], [5, 3], [10, 5], [15, 10], [25, 10], [45, 15], [90, 30]];
const THEMES: { id: Settings['boardTheme']; label: string }[] = [
  { id: 'imperio', label: 'Imperio' },
  { id: 'nogal', label: 'Nogal' },
  { id: 'torneo', label: 'Torneo' },
  { id: 'pizarra', label: 'Pizarra' },
];

interface Props {
  settings: Settings;
  onUpdate(p: Partial<Settings>): void;
  world: PublicWorld;
  name: string;
  asMaster: boolean;
  onRename(name: string): void;
  onLeave(): void;
  onMaster(): void;
}

export function SettingsScreen({ settings: s, onUpdate, world, name, asMaster, onRename, onLeave, onMaster }: Props) {
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
  const [nm, setNm] = useState(name);
  return (
    <div class="page-inner">
      <header class="page-head">
        <div>
          <span class="eyebrow">Este dispositivo</span>
          <h1>Ajustes</h1>
          <p class="lede">Los cambios se aplican a la próxima línea. Una partida en curso no se toca.</p>
        </div>
        <button type="button" class="master-star inline" aria-label="Acceso del maestro" title="Acceso del maestro" onClick={onMaster}>★</button>
      </header>

      <section class="panel settings world-panel" style={{ '--h': world.hue } as any}>
        <Emblem emblem={world.emblem} hue={world.hue} size={52} />
        <div class="wp-id">
          <span class="eyebrow">{asMaster ? 'Estás como maestro en' : 'Estás en'}</span>
          <span class="wp-name">{world.name}</span>
        </div>
        <button type="button" class="btn ghost" onClick={onLeave}>Cambiar de repertorio</button>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Tu nombre</h2>
        <form class="inline-form" onSubmit={(e) => { e.preventDefault(); if (nm.trim()) onRename(nm.trim()); }}>
          <input id="player-name" class="input" value={nm} maxLength={40} onInput={(e) => setNm((e.target as HTMLInputElement).value)} />
          <button type="submit" class="btn ghost small" disabled={!nm.trim() || nm.trim() === name}>Guardar</button>
        </form>
        <p class="help">Tus partidas se guardan con este nombre. Si lo cambias, verás las partidas guardadas con el nombre nuevo.</p>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Ritmo</h2>
        <div class="chips" role="radiogroup" aria-label="Ritmos rápidos">
          {PRESETS.map(([m, i]) => (
            <button type="button" role="radio" aria-checked={s.baseMin === m && s.incSec === i} class={`chip mono ${s.baseMin === m && s.incSec === i ? 'active' : ''}`} onClick={() => onUpdate({ baseMin: m, incSec: i })}>
              {m}+{i}
            </button>
          ))}
        </div>
        <div class="inline-fields">
          <label class="mini-field" for="base-min">Minutos<input id="base-min" class="input small num" type="number" inputMode="numeric" min={1} max={180} value={s.baseMin} onChange={(e) => onUpdate({ baseMin: num((e.target as HTMLInputElement).value, 1, 180) })} /></label>
          <label class="mini-field" for="inc-sec">Incremento (s)<input id="inc-sec" class="input small num" type="number" inputMode="numeric" min={0} max={60} value={s.incSec} onChange={(e) => onUpdate({ incSec: num((e.target as HTMLInputElement).value, 0, 60) })} /></label>
        </div>
        <p class="help">El reloj arranca con la primera jugada y sigue corriendo mientras corriges un error de la línea.</p>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Desde qué jugada empiezas</h2>
        <Segmented id="start-mode" value={s.startMode} options={[{ value: 'start', label: 'Desde el inicio' }, { value: 'fixed', label: 'Jugada fija' }, { value: 'random', label: 'Al azar' }]} onChange={(v) => onUpdate({ startMode: v })} />
        {s.startMode === 'fixed' && (
          <label class="mini-field" for="start-move">Empiezo en la jugada<input id="start-move" class="input small num" type="number" inputMode="numeric" min={1} max={80} value={s.startMove} onChange={(e) => onUpdate({ startMove: num((e.target as HTMLInputElement).value, 1, 80) })} /></label>
        )}
        {s.startMode === 'random' && (
          <label class="mini-field" for="random-max">Entre la jugada 1 y la<input id="random-max" class="input small num" type="number" inputMode="numeric" min={2} max={80} value={s.randomMax} onChange={(e) => onUpdate({ randomMax: num((e.target as HTMLInputElement).value, 2, 80) })} /></label>
        )}
        <p class="help">
          {s.startMode === 'start' ? 'El tablero aparece en la posición inicial y juegas la línea completa.' :
            'El tablero aparece ya en esa posición, con las jugadas anteriores en la lista.'}
        </p>
      </section>

      <section class="panel settings">
        <h2 class="section-title">Tablero</h2>
        <div class="swatches" role="radiogroup" aria-label="Colores del tablero">
          {THEMES.map((t) => (
            <button type="button" role="radio" aria-checked={s.boardTheme === t.id} class={`swatch theme-${t.id} ${s.boardTheme === t.id ? 'active' : ''}`} onClick={() => onUpdate({ boardTheme: t.id })}>
              <span class="swatch-board" aria-hidden="true"><i /><i /><i /><i /></span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div class="toggle-row"><span>Coordenadas</span><Toggle id="coords" checked={s.coords} label="Coordenadas" onChange={(v) => onUpdate({ coords: v })} /></div>
        <div class="toggle-row">
          <span>Sonido</span>
          <span class="toggle-side">
            {s.sound && <button type="button" class="btn ghost small" onClick={() => sound.preview()}>Escuchar</button>}
            <Toggle id="sound" checked={s.sound} label="Sonido" onChange={(v) => onUpdate({ sound: v })} />
          </span>
        </div>
      </section>

      <p class="help credits">Motor: Stockfish 19 lite (GPLv3), en tu dispositivo. Tablero: chessground (GPLv3). Sonidos: Kenney (CC0).</p>
    </div>
  );
}
