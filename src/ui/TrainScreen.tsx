import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Chess, SQUARES, type Square } from 'chess.js';
import { Board } from './Board';
import { BotAvatar, Icon, PieceDot } from './parts';
import { BOTS, botById, type Bot } from '../lib/bots';
import { Session, type PlayedMove } from '../lib/session';
import type { Engine } from '../lib/engine';
import type { Line, RepMeta, Repertoire } from '../../shared/types';
import type { Settings } from '../lib/prefs';
import type { NewGame } from '../lib/api';
import { fmtClock } from '../lib/clock';
import { sound } from '../lib/sound';

export interface SaveResult { ok: boolean; message: string }

interface Props {
  settings: Settings;
  reps: Repertoire[];
  disabled: string[];
  linesLoaded: boolean;
  engine: () => Engine;
  playerName: string;
  isMaster: boolean;
  onSaveGame(g: NewGame): Promise<SaveResult>;
  onUpdateSettings(p: Partial<Settings>): void;
  onOpenMaster(): void;
  goTo(tab: string): void;
}

const colorName = (c: 'w' | 'b') => (c === 'w' ? 'white' : 'black');

function destsOf(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const s of SQUARES) {
    const ms = chess.moves({ square: s, verbose: true });
    if (ms.length) dests.set(s as Key, ms.map((m) => m.to as Key));
  }
  return dests;
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function TrainScreen(p: Props) {
  const { settings } = p;
  const cg = useRef<Api | null>(null);
  const sess = useRef<Session | null>(null);
  const meta = useRef<{ rep: RepMeta; line: Line; bot: Bot } | null>(null);
  const [, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const [flash, setFlash] = useState(0);
  const [promo, setPromo] = useState<{ orig: Key; dest: Key } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [save, setSave] = useState<{ state: 'idle' | 'saving' | 'saved' | 'discarded'; res?: SaveResult }>({ state: 'idle' });
  const [confirmResign, setConfirmResign] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [engineErr, setEngineErr] = useState(false);
  const [hintMove, setHintMove] = useState<string | null>(null);
  const wake = useRef<any>(null);
  const movesEnd = useRef<HTMLDivElement>(null);

  const pool = useMemo(() => {
    const out: { rep: RepMeta; line: Line }[] = [];
    for (const rep of p.reps) if (!p.disabled.includes(rep.id)) for (const line of rep.lines) out.push({ rep, line });
    return out;
  }, [p.reps, p.disabled.join(',')]);

  const s = sess.current;
  const userColor = s?.cfg.userColor ?? meta.current?.rep.color ?? 'w';

  /* ---------- board sync ---------- */
  function sync() {
    const api = cg.current;
    const se = sess.current;
    if (!api) return;
    if (!se) {
      api.set({ fen: 'start', lastMove: undefined, check: false, movable: { color: undefined, dests: new Map() }, premovable: { enabled: false } });
      return;
    }
    const c = se.chess;
    const last = se.played[se.played.length - 1];
    api.set({
      fen: c.fen(),
      orientation: colorName(se.cfg.userColor),
      turnColor: colorName(c.turn()),
      lastMove: last ? ([last.uci.slice(0, 2), last.uci.slice(2, 4)] as Key[]) : undefined,
      check: c.inCheck() ? colorName(c.turn()) : false,
      movable: { free: false, color: se.phase === 'over' ? undefined : colorName(se.cfg.userColor), dests: se.userTurn ? destsOf(c) : new Map(), showDests: true },
      premovable: { enabled: se.phase === 'bot' },
      highlight: { lastMove: true, check: true, custom: new Map() },
    });
    if (!hintMove) api.setAutoShapes([]);
  }

  /* ---------- session lifecycle ---------- */
  function newSession() {
    sess.current?.destroy();
    sess.current = null;
    setSheetOpen(false);
    setSave({ state: 'idle' });
    setConfirmResign(false);
    setPromo(null);
    setHintMove(null);
    setBanner(null);
    if (!pool.length) { meta.current = null; sync(); bump(); return; }
    const candidates = pool.length > 1 ? pool.filter((x) => x.line.id !== settings.lastLineId) : pool;
    const { rep, line } = pick(candidates);
    const enabledBots = BOTS.filter((b) => settings.enabledBots.includes(b.id));
    const bot = pick(enabledBots.length ? enabledBots : BOTS);
    const startMove = settings.startMode === 'start' ? 1
      : settings.startMode === 'fixed' ? Math.max(1, settings.startMove)
      : 1 + Math.floor(Math.random() * Math.max(1, settings.randomMax));
    meta.current = { rep, line, bot };
    let engine: Engine | null = null;
    try { engine = p.engine(); } catch { engine = null; }
    const se = new Session(
      { line, userColor: rep.color, bot, elo: settings.elo, baseMs: settings.baseMin * 60_000, incMs: settings.incSec * 1000, botMoveMs: settings.botMoveSec * 1000, startMove },
      engine,
      {
        change: bump,
        move(m, by) {
          const api = cg.current;
          if (api && by !== 'user') api.move(m.from as Key, m.to as Key);
          if (m.san.includes('+') || m.san.includes('#')) sound.check();
          else if (m.flags.includes('k') || m.flags.includes('q')) sound.castle();
          else if (m.captured) sound.capture();
          else sound.move();
          setHintMove(null);
          sync();
          if (by === 'bot') setTimeout(() => cg.current?.playPremove(), 30);
        },
        wrong() { /* handled in commit */ },
        phase() {
          sound.phase();
          const b = meta.current?.bot;
          setBanner(settings.revealBot === 'start' && b ? `Línea completada. Ahora juegas contra ${b.name}.` : 'Línea completada. Ahora juegas contra el bot.');
          setTimeout(() => setBanner(null), 3200);
        },
        end() {
          sound.end();
          setTimeout(() => setSheetOpen(true), 450);
          try { wake.current?.release?.(); } catch { /* ignore */ }
          wake.current = null;
        },
        engineError() { setEngineErr(true); },
      },
    );
    sess.current = se;
    p.onUpdateSettings({ lastLineId: line.id });
    sync();
    se.start();
    bump();
    try {
      (navigator as any).wakeLock?.request('screen').then((w: any) => { wake.current = w; }).catch(() => {});
    } catch { /* not available */ }
  }

  // start once lines are available; restart when the pool changes and nothing is in progress
  useEffect(() => {
    if (!p.linesLoaded) return;
    const se = sess.current;
    // Only replace a session nobody has touched yet; never one in progress or one waiting to be saved.
    const fresh = !se || (se.phase !== 'over' && !se.played.some((m) => m.by === 'user'));
    if (fresh) newSession();
  }, [p.linesLoaded, pool, settings.baseMin, settings.incSec, settings.startMode, settings.startMove, settings.randomMax, settings.elo, settings.botMoveSec, settings.enabledBots.join(','), settings.revealBot]);

  useEffect(() => () => { sess.current?.destroy(); try { wake.current?.release?.(); } catch { /* ignore */ } }, []);

  // clock tick
  useEffect(() => {
    const t = setInterval(() => sess.current?.tick(), 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { movesEnd.current?.scrollIntoView({ block: 'nearest' }); });

  /* ---------- moves ---------- */
  function commit(uci: string) {
    const se = sess.current;
    if (!se) return;
    const res = se.userMove(uci);
    if (res === 'wrong') {
      sound.wrong();
      setFlash((f) => f + 1);
      const api = cg.current;
      if (api) {
        api.set({ highlight: { lastMove: true, check: true, custom: new Map([[uci.slice(2, 4) as Key, 'wrong']]) } });
        setTimeout(() => { sync(); }, 260);
      }
      return;
    }
    if (res === 'illegal') sync();
  }

  function onUserMove(orig: Key, dest: Key) {
    const se = sess.current;
    if (!se) return;
    const piece = se.chess.get(orig as Square);
    if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) { setPromo({ orig, dest }); return; }
    commit(orig + dest);
  }

  function choosePromo(role: 'q' | 'r' | 'b' | 'n' | null) {
    const pr = promo;
    setPromo(null);
    if (!pr || !role) { sync(); return; }
    commit(pr.orig + pr.dest + role);
  }

  function showHint() {
    const se = sess.current;
    const mv = se?.hint();
    if (!mv || !cg.current) return;
    setHintMove(mv);
    cg.current.setAutoShapes([{ orig: mv.slice(0, 2) as Key, dest: mv.slice(2, 4) as Key, brush: 'green' }]);
  }

  async function doSave() {
    const se = sess.current, m = meta.current;
    if (!se || !m || !se.result) return;
    setSave({ state: 'saving' });
    const record: NewGame = {
      repId: m.rep.id,
      repName: m.rep.name,
      lineId: m.line.id,
      lineEvent: m.line.event,
      lineWhite: m.line.white,
      lineBlack: m.line.black,
      userColor: se.cfg.userColor,
      botId: m.bot.id,
      botName: m.bot.name,
      botElo: se.cfg.elo,
      result: se.result,
      termination: se.termination ?? '',
      timeControl: `${settings.baseMin * 60}+${settings.incSec}`,
      ...(m.line.fen ? { startFen: m.line.fen } : {}),
      sans: se.played.map((x) => x.san),
      clocks: se.played.map((x) => Math.round(x.clock)),
      linePlies: se.linePlies,
      lineErrors: se.mistakes,
    };
    const res = await p.onSaveGame(record);
    setSave({ state: res.ok ? 'saved' : 'idle', res });
  }

  /* ---------- render helpers ---------- */
  const m = meta.current;
  const phase = s?.phase ?? 'line';
  const revealed = !!m && (phase === 'over' || (phase === 'bot' && settings.revealBot === 'start'));
  const oppColor = userColor === 'w' ? 'b' : 'w';

  const rows = useMemo(() => buildRows(s?.played ?? [], s?.startFen, s?.linePlies ?? 0), [s?.played.length, s, s?.linePlies]);

  const outcomeText = s?.outcome === 'win' ? 'Ganaste' : s?.outcome === 'loss' ? 'Perdiste' : s?.outcome === 'draw' ? 'Tablas' : '';
  const userMoves = s ? s.played.filter((x) => x.by === 'user').length : 0;

  if (!p.linesLoaded) {
    return <div class="train"><div class="board-col"><div class="board-placeholder"><div class="spinner" />Preparando tu repertorio…</div></div></div>;
  }

  return (
    <div class="train">
      <div class="board-col">
        <PlayerStrip
          top
          name={revealed && m ? m.bot.name : 'Rival'}
          caption={revealed && m ? `${m.bot.styleLabel} · ≈${settings.elo}` : settings.revealBot === 'end' ? 'Se revela al terminar' : 'Se revela tras la línea'}
          avatar={<BotAvatar bot={m?.bot} hidden={!revealed} size={36} />}
          side={oppColor}
          session={s}
          thinking={!!s?.thinking}
        />
        <div class="board-area">
          <Board
            theme={settings.boardTheme}
            coords={settings.coords}
            flash={flash}
            onReady={(api) => { cg.current = api; sync(); }}
            config={{ movable: { free: false, events: { after: onUserMove } }, premovable: { enabled: false, events: {} } }}
          />
          {promo && (
            <div class="promo" role="dialog" aria-label="Elige la pieza de coronación">
              <div class="promo-card">
                <span class="promo-title">Coronar como</span>
                <div class="cg-wrap promo-row">
                  {(['q', 'r', 'b', 'n'] as const).map((r) => (
                    <button type="button" class="promo-piece" aria-label={{ q: 'Dama', r: 'Torre', b: 'Alfil', n: 'Caballo' }[r]} onClick={() => choosePromo(r)}>
                      <piece class={`${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[r]} ${colorName(userColor)}`} />
                    </button>
                  ))}
                </div>
                <button type="button" class="btn ghost small" onClick={() => choosePromo(null)}>Cancelar</button>
              </div>
            </div>
          )}
          {!s && pool.length === 0 && (
            <div class="board-empty">
              <div class="empty-card">
                <span class="eyebrow">{p.reps.length ? 'Nada seleccionado' : 'Mundo en preparación'}</span>
                <h2>{p.reps.length ? 'Activa algún repertorio' : 'Aún no hay líneas aquí'}</h2>
                <p>{p.reps.length
                  ? 'Todos los repertorios de este mundo están desactivados. Activa al menos uno en la pestaña Repertorio.'
                  : p.isMaster ? 'Sube el primer PGN de este mundo desde la Sala del maestro.' : 'Tu entrenador todavía no ha subido repertorios a este mundo. Vuelve a intentarlo más tarde.'}</p>
                <div class="empty-actions">
                  {p.reps.length > 0 && <button type="button" class="btn primary" onClick={() => p.goTo('reps')}>Ir a Repertorio</button>}
                  {!p.reps.length && p.isMaster && <button type="button" class="btn primary" onClick={p.onOpenMaster}>Abrir la Sala del maestro</button>}
                </div>
              </div>
            </div>
          )}
          {banner && <div class="banner" role="status">{banner}</div>}
          {sheetOpen && s?.phase === 'over' && m && (
            <EndSheet
              outcomeText={outcomeText}
              outcome={s.outcome!}
              termination={s.termination ?? ''}
              result={s.result!}
              line={m.line}
              rep={m.rep}
              bot={m.bot}
              elo={settings.elo}
              mistakes={s.mistakes}
              hints={s.hints}
              userMoves={userMoves}
              linePlies={s.linePlies}
              save={save}
              onSave={doSave}
              onDiscard={() => setSave({ state: 'discarded' })}
              onNext={newSession}
              onClose={() => setSheetOpen(false)}
              onOpenGames={() => { setSheetOpen(false); p.goTo('games'); }}
            />
          )}
        </div>
        <PlayerStrip
          name={p.playerName}
          caption={m ? `${userColor === 'w' ? 'Blancas' : 'Negras'} · ${settings.baseMin}+${settings.incSec}` : ''}
          avatar={<span class="me-badge"><PieceDot color={userColor} /></span>}
          side={userColor}
          session={s}
          thinking={false}
        />
      </div>

      <aside class="side-col">
        <section class="status-card">
          <div class="status-head">
            {phase === 'line' && <span class="pill brass">I · Tu línea</span>}
            {phase === 'bot' && <span class="pill blue">II · Partida</span>}
            {phase === 'over' && <span class={`pill ${s?.outcome}`}>{outcomeText} · {s?.result?.replace('1/2-1/2', '½–½')}</span>}
            {m && <span class="rep-name" title={m.rep.name}>{m.rep.name}</span>}
          </div>
          {phase === 'line' && s && (
            <p class="status-text">
              {s.userTurn ? 'Tu turno: juega la jugada de tu repertorio.' : 'El rival responde con la línea…'}
              {s.mistakes > 0 && <span class="err-count"> · {s.mistakes} {s.mistakes === 1 ? 'error' : 'errores'}</span>}
            </p>
          )}
          {phase === 'bot' && s && (
            <p class="status-text">{s.thinking ? 'El bot está pensando…' : 'Tu turno.'} {engineErr && <span class="err-count">El motor no pudo cargarse en este dispositivo.</span>}</p>
          )}
          {phase === 'over' && !sheetOpen && (
            <button type="button" class="btn primary block" onClick={() => setSheetOpen(true)}>Ver resumen y guardar</button>
          )}
          {phase === 'line' && s && s.attempts >= 3 && !hintMove && (
            <button type="button" class="btn ghost small" onClick={showHint}><Icon name="eye" size={16} />Ver la jugada</button>
          )}
        </section>

        <section class="moves" aria-label="Jugadas">
          {rows.length === 0 && <p class="moves-empty">Las jugadas aparecerán aquí.</p>}
          {rows.map((r) => (
            <div class="move-row">
              <span class="mno">{r.no}.</span>
              <span class={`mv ${r.wc}`}>{r.w?.san ?? (r.w === null ? '…' : '')}</span>
              <span class={`mv ${r.bc}`}>{r.b?.san ?? ''}</span>
            </div>
          ))}
          <div ref={movesEnd} />
        </section>
        <div class="legend"><span class="lg lg-line" />Línea de repertorio<span class="lg lg-free" />Partida libre</div>

        <section class="actions">
          {phase === 'line' && (
            <button type="button" class="btn ghost" onClick={newSession} disabled={pool.length === 0}><Icon name="skip" size={18} />Otra línea</button>
          )}
          {phase === 'bot' && !confirmResign && (
            <button type="button" class="btn ghost" onClick={() => setConfirmResign(true)}><Icon name="flag" size={18} />Abandonar</button>
          )}
          {phase === 'bot' && confirmResign && (
            <div class="confirm">
              <span>¿Abandonar la partida?</span>
              <button type="button" class="btn danger small" onClick={() => { setConfirmResign(false); sess.current?.resign(); }}>Sí, abandonar</button>
              <button type="button" class="btn ghost small" onClick={() => setConfirmResign(false)}>Seguir</button>
            </div>
          )}
          {phase === 'over' && (
            <button type="button" class="btn primary" onClick={newSession}><Icon name="next" size={18} />Siguiente línea</button>
          )}
        </section>
      </aside>
    </div>
  );
}

/* ---------- pieces ---------- */

function PlayerStrip({ name, caption, avatar, side, session, thinking, top }: { name: string; caption: string; avatar: any; side: 'w' | 'b'; session: Session | null; thinking: boolean; top?: boolean }) {
  return (
    <div class={`player ${top ? 'top' : 'bottom'}`}>
      {avatar}
      <div class="player-id">
        <span class="player-name">{name}{thinking && <span class="thinking" aria-label="pensando"><i /><i /><i /></span>}</span>
        <span class="player-caption">{caption}</span>
      </div>
      <ClockFace side={side} session={session} />
    </div>
  );
}

function ClockFace({ side, session }: { side: 'w' | 'b'; session: Session | null }) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), 100); return () => clearInterval(t); }, []);
  if (!session) return <div class="clock idle">–:––</div>;
  const ms = session.clock.left(side);
  const active = session.clock.running === side && session.phase !== 'over';
  const low = ms < 20_000;
  return <div class={`clock ${active ? 'active' : ''} ${low && active ? 'low' : ''}`} aria-label="Reloj">{fmtClock(ms)}</div>;
}

interface Row { no: number; w?: PlayedMove | null; b?: PlayedMove; wc: string; bc: string }
function buildRows(played: PlayedMove[], startFen: string | undefined, linePlies: number): Row[] {
  const fen = startFen ?? 'x x x x x 1';
  let no = Number(fen.split(' ')[5]) || 1;
  let turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const rows: Row[] = [];
  let cur: Row | null = null;
  played.forEach((mv, i) => {
    const cls = mv.by === 'pre' ? 'line pre' : i < linePlies ? 'line' : 'free';
    if (turn === 'w') { cur = { no, w: mv, wc: cls, bc: '' }; rows.push(cur); }
    else { if (!cur) { cur = { no, w: null, wc: '', bc: '' }; rows.push(cur); } cur.b = mv; cur.bc = cls; no++; cur = null; }
    turn = turn === 'w' ? 'b' : 'w';
  });
  return rows;
}

function EndSheet(props: {
  outcomeText: string; outcome: 'win' | 'loss' | 'draw'; termination: string; result: string;
  line: Line; rep: RepMeta; bot: Bot; elo: number; mistakes: number; hints: number; userMoves: number; linePlies: number;
  save: { state: string; res?: SaveResult }; onSave(): void; onDiscard(): void; onNext(): void; onClose(): void; onOpenGames(): void;
}) {
  const { line, bot, save } = props;
  return (
    <div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-label="Resumen de la partida">
        <div class={`sheet-result ${props.outcome}`}>
          <span class="result-big">{props.outcomeText}</span>
          <span class="result-sub">{props.termination} · {props.result.replace('1/2-1/2', '½–½')}</span>
        </div>
        <div class="sheet-block">
          <span class="eyebrow">Variante jugada{line.event ? ` · ${line.event}` : ''}</span>
          <h3 class="variant-title">{line.white || 'Sin nombre'}</h3>
          {line.black && line.black !== '?' && <span class="variant-sub">{line.black}</span>}
        </div>
        <div class="sheet-grid">
          <div class="sheet-bot">
            <BotAvatar bot={bot} size={40} />
            <div>
              <span class="bot-name">{bot.name}</span>
              <span class="bot-meta">{bot.styleLabel} · ≈{props.elo}</span>
            </div>
          </div>
          <dl class="stats">
            <div><dt>Errores en la línea</dt><dd>{props.mistakes}</dd></div>
            <div><dt>Jugadas de línea</dt><dd>{Math.ceil(props.linePlies / 2)}</dd></div>
            {props.hints > 0 && <div><dt>Ayudas usadas</dt><dd>{props.hints}</dd></div>}
          </dl>
        </div>

        {save.state === 'idle' && (
          <div class="save-ask">
            <p>¿Guardar esta partida en tu registro?</p>
            {save.res && !save.res.ok && <p class="save-msg bad">{save.res.message}</p>}
            <div class="save-actions">
              <button type="button" class="btn primary" onClick={props.onSave}><Icon name="check" size={18} />Guardar</button>
              <button type="button" class="btn ghost" onClick={props.onDiscard}>No guardar</button>
            </div>
          </div>
        )}
        {save.state === 'saving' && <div class="save-ask"><p class="save-msg"><span class="spinner small" />Guardando…</p></div>}
        {save.state === 'saved' && save.res && (
          <div class="save-ask">
            <p class="save-msg good"><Icon name="check" size={16} />{save.res.message}</p>
            <button type="button" class="btn ghost small" onClick={props.onOpenGames}>Ver en Partidas</button>
          </div>
        )}
        {save.state === 'discarded' && <div class="save-ask"><p class="save-msg">Partida descartada.</p></div>}

        <div class="sheet-foot">
          <button type="button" class="btn ghost" onClick={props.onClose}>Ver tablero</button>
          <button type="button" class="btn primary" onClick={props.onNext} disabled={save.state === 'saving'}>Siguiente línea<Icon name="next" size={18} /></button>
        </div>
      </div>
    </div>
  );
}
