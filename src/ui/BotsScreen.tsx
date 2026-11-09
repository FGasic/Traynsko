import { useEffect, useState } from 'preact/hooks';
import { BotAvatar, Toggle } from './parts';
import { BOTS } from '../lib/bots';
import type { Settings } from '../lib/prefs';
import type { MaiaState } from '../lib/maia';

const MAIA_NOTE: Record<MaiaState, string> = {
  idle: 'El modelo se descarga la primera vez que juega (unos 12 MB).',
  loading: 'Preparando el modelo en este dispositivo…',
  ready: 'Modelo listo en este dispositivo.',
  failed: 'Este dispositivo no pudo cargar el modelo: mientras tanto juega con Stockfish.',
};

export function BotsScreen({ settings, onUpdate, maiaState }: { settings: Settings; onUpdate(p: Partial<Settings>): void; maiaState(): MaiaState }) {
  const enabled = new Set(settings.enabledBots);
  const [state, setState] = useState<MaiaState>(maiaState());
  useEffect(() => {
    const t = setInterval(() => setState(maiaState()), 700);
    return () => clearInterval(t);
  }, []);
  const toggle = (id: string, on: boolean) => {
    const next = BOTS.map((b) => b.id).filter((x) => (x === id ? on : enabled.has(x)));
    if (next.length === 0) return; // keep at least one
    onUpdate({ enabledBots: next });
  };
  return (
    <div class="page-inner">
      <header class="page-head">
        <div>
          <h1>Bots</h1>
          <p class="lede">Al terminar la línea juegas contra uno de los bots marcados, elegido al azar. Trayner juega como una persona del nivel elegido; los demás usan Stockfish con un margen y un estilo propios. Todo se calcula en tu dispositivo.</p>
        </div>
      </header>

      <section class="panel controls">
        <div class="control">
          <label class="field-label" for="bot-elo">Fuerza aproximada</label>
          <div class="range-row">
            <input id="bot-elo" type="range" min={1800} max={2800} step={50} value={settings.elo} onInput={(e) => onUpdate({ elo: Number((e.target as HTMLInputElement).value) })} />
            <output class="range-out" for="bot-elo">≈{settings.elo}</output>
          </div>
          <p class="help">Para Trayner, el nivel de la persona que imita. Para los demás, cuánto pueden alejarse de la mejor jugada; el bot Máquina ignora casi todo el margen.</p>
        </div>
        <div class="control">
          <label class="field-label" for="bot-time">Tiempo medio del bot por jugada</label>
          <div class="range-row">
            <input id="bot-time" type="range" min={1} max={10} step={1} value={settings.botMoveSec} onInput={(e) => onUpdate({ botMoveSec: Number((e.target as HTMLInputElement).value) })} />
            <output class="range-out" for="bot-time">{settings.botMoveSec} s</output>
          </div>
          <p class="help">Trayner piensa poco en las jugadas obvias y más cuando la posición es complicada; los demás varían ±20 %. Con poco tiempo en su reloj, todos juegan más rápido.</p>
        </div>
      </section>

      <ul class="bot-grid">
        {BOTS.map((b) => (
          <li class={`bot-card ${enabled.has(b.id) ? '' : 'off'}`}>
            <div class="bot-top">
              <BotAvatar bot={b} size={44} />
              <div class="bot-id">
                <span class="bot-name">{b.name}</span>
                <span class="bot-style">{b.styleLabel}</span>
              </div>
              <Toggle id={`bot-${b.id}`} checked={enabled.has(b.id)} label={`Jugar contra ${b.name}`} onChange={(v) => toggle(b.id, v)} />
            </div>
            <p class="bot-blurb">{b.blurb}</p>
            {b.human && (
              <p class="bot-note">
                <span class={`maia-state ms-${state}`}>{MAIA_NOTE[state]}</span>
                <span class="bot-credit">Modelo Maia-3 del CSSLab (Universidad de Toronto), licencia AGPL-3.0 · <a href="https://github.com/CSSLab/maia3" target="_blank" rel="noopener">Maia-3</a> · <a href="https://github.com/FGasic/Traynsko" target="_blank" rel="noopener">código de Traynsko</a></span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
