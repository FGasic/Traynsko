import { BotAvatar, Toggle } from './parts';
import { BOTS } from '../lib/bots';
import type { Settings } from '../lib/prefs';

export function BotsScreen({ settings, onUpdate }: { settings: Settings; onUpdate(p: Partial<Settings>): void }) {
  const enabled = new Set(settings.enabledBots);
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
          <p class="lede">Al terminar la línea juegas contra uno de los bots marcados, elegido al azar. Todos usan Stockfish en tu dispositivo y eligen entre jugadas de valor parecido, así que la misma posición da partidas distintas.</p>
        </div>
      </header>

      <section class="panel controls">
        <div class="control">
          <label class="field-label" for="bot-elo">Fuerza aproximada</label>
          <div class="range-row">
            <input id="bot-elo" type="range" min={1800} max={2800} step={50} value={settings.elo} onInput={(e) => onUpdate({ elo: Number((e.target as HTMLInputElement).value) })} />
            <output class="range-out" for="bot-elo">≈{settings.elo}</output>
          </div>
          <p class="help">Controla cuánto puede alejarse el bot de la mejor jugada. 2300 deja variedad sin regalar material; el bot Máquina ignora casi todo el margen.</p>
        </div>
        <div class="control">
          <label class="field-label" for="bot-time">Tiempo del bot por jugada</label>
          <div class="range-row">
            <input id="bot-time" type="range" min={1} max={10} step={1} value={settings.botMoveSec} onInput={(e) => onUpdate({ botMoveSec: Number((e.target as HTMLInputElement).value) })} />
            <output class="range-out" for="bot-time">{settings.botMoveSec} s</output>
          </div>
          <p class="help">Varía ±20 % para que no parezca un metrónomo. Con poco tiempo en su reloj, juega más rápido.</p>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
