import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Chess, SQUARES, type Square } from 'chess.js';
import { Board } from './Board';
import { Icon, Segmented } from './parts';
import { PlayerStrip, buildRows } from './TrainScreen';
import { BOTS } from '../lib/bots';
import { Session, type GameSnap } from '../lib/session';
import { Engine } from '../lib/engine';
import type { Maia } from '../lib/maia';
import type { NewGame } from '../lib/api';
import type { Settings } from '../lib/prefs';
import type { CampaignLocal } from '../lib/campaign';
import { sound } from '../lib/sound';
import { useBoardFit } from '../lib/fit';
import type { Line, RepMeta } from '../../shared/types';
import { CAMPAIGN, streakToday, type CampaignOutcome, type CampaignResult, type CampaignView } from '../../shared/campaign';
import { notaText } from '../../shared/netero';

const colorName = (c: 'w' | 'b') => (c === 'w' ? 'white' : 'black');
const RESULT_TEXT: Record<CampaignResult, string> = { win: 'Ganaste', draw: 'Tablas', loss: 'Perdiste' };
const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

function destsOf(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const s of SQUARES) {
    const ms = chess.moves({ square: s, verbose: true });
    if (ms.length) dests.set(s as Key, ms.map((m) => m.to as Key));
  }
  return dests;
}

export interface GameEnd { result: CampaignResult; moves: number; resigned: boolean; game: NewGame }

/* ---------------- the card in the Netero screen ---------------- */

export function CampaignCard(p: {
  account: boolean;
  signingIn: boolean;
  onLogin(): void;
  view: CampaignView | null;
  error: string | null;
  onRetry(): void;
  local: CampaignLocal | null;
  today: string;
  hasLines: boolean;
  onStart(start?: number): void;
  onContinue(): void;
}) {
  const [start, setStart] = useState(CAMPAIGN.startDefault);
  if (!p.account) {
    return (
      <section class="panel nt-card camp-card" aria-label="Campaña de hoy">
        <div class="panel-head"><h2 class="section-title">Campaña de hoy</h2></div>
        <p class="help">Cada día: un Netero de 3 líneas y una partida completa contra Trayner desde el final de una de ellas. Tu racha y el nivel del rival se guardan con tu cuenta.</p>
        <div class="row-actions"><button type="button" class="btn primary" onClick={p.onLogin} disabled={p.signingIn}><Icon name="login" size={18} />{p.signingIn ? 'Conectando…' : 'Entrar con Lichess'}</button></div>
      </section>
    );
  }
  if (!p.view) {
    return (
      <section class="panel nt-card camp-card" aria-label="Campaña de hoy">
        <div class="panel-head"><h2 class="section-title">Campaña de hoy</h2></div>
        {p.error ? <p class="notice bad">{p.error} <button type="button" class="btn ghost small" onClick={p.onRetry}>Reintentar</button></p> : <div class="loading"><div class="spinner" />Cargando la Campaña…</div>}
      </section>
    );
  }
  const { campaign } = p.view;
  const st = streakToday(p.view.streak, p.today);
  const local = p.local;
  const doneHere = campaign?.lastDay === p.today || (local?.phase === 'done' && local.day === p.today);
  const inProgress = !!local && local.phase !== 'done';
  const level = local && inProgress ? local.level : campaign?.level ?? start;
  const todayEntry = campaign?.history.slice().reverse().find((h) => h.day === p.today);
  const status = inProgress ? 'En curso' : doneHere ? 'Completada' : 'Pendiente';
  const next = st.rewards.includes('board-campana') ? `${dias(st.nextTruce)} para la próxima tregua` : `Tablero exclusivo con 7 días de racha · faltan ${Math.max(1, 7 - st.cur)}`;
  const continueLabel = !local ? '' : local.phase === 'memory' ? 'Continuar la memoria' : local.phase === 'game' ? (local.game ? 'Continuar la partida' : 'Jugar la partida') : 'Guardar el resultado';
  return (
    <section class={`panel nt-card camp-card ${doneHere && !inProgress ? 'done' : ''}`} aria-label="Campaña de hoy">
      <div class="panel-head">
        <h2 class="section-title">Campaña de hoy</h2>
        <span class={`pill ${doneHere && !inProgress ? 'win' : inProgress ? 'blue' : 'brass'}`}>{status}</span>
      </div>
      <div class="camp-stats">
        <div><b>{st.cur}</b><span>{st.cur === 1 ? 'día de racha' : 'días de racha'}</span></div>
        <div><b>{st.truces}<small> / {CAMPAIGN.truceMax}</small></b><span>{st.truces === 1 ? 'tregua' : 'treguas'}</span></div>
        <div><b>{level}</b><span>{campaign || inProgress ? 'nivel del rival' : 'nivel inicial'}</span></div>
        <div><b>{st.best}</b><span>mejor racha</span></div>
      </div>
      {!doneHere && !inProgress && <p class="help">Un Netero de 3 líneas y una partida completa {CAMPAIGN.baseMin}+{CAMPAIGN.incSec} contra Trayner desde el final de una de ellas. El rival sube 50 si ganas y baja 50 si pierdes.</p>}
      {doneHere && !inProgress && todayEntry && (
        <p class="camp-today">
          <Icon name="check" size={16} />Hoy: {RESULT_TEXT[todayEntry.result].toLowerCase()} contra {todayEntry.rival} · rival {todayEntry.level} → {todayEntry.after}
          {todayEntry.nota !== null && <> · memoria {notaText(todayEntry.nota)}</>}
          {!todayEntry.counted && <> · sin racha (abandono antes de la jugada {CAMPAIGN.minResignMove})</>}
        </p>
      )}
      {!campaign && !inProgress && !doneHere && (
        <div class="control camp-start">
          <span class="field-label">Nivel inicial del rival</span>
          <Segmented id="camp-start" value={String(start)} options={CAMPAIGN.startChoices.map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => setStart(Number(v))} />
          <p class="help">Solo se elige una vez; después el nivel lo mueven tus resultados.</p>
        </div>
      )}
      <div class="row-actions camp-actions">
        {inProgress && <button type="button" class="btn primary" onClick={p.onContinue}><Icon name="play" size={18} />{continueLabel}</button>}
        {!inProgress && !doneHere && <button type="button" class="btn primary" disabled={!p.hasLines} onClick={() => p.onStart(campaign ? undefined : start)}><Icon name="play" size={18} />Empezar la Campaña</button>}
        {!inProgress && doneHere && <span class="hint-text">Vuelve mañana para la siguiente.</span>}
        <span class="camp-next">{st.doneToday ? 'Racha de hoy: hecha' : next}</span>
      </div>
    </section>
  );
}

/* ---------------- the game ---------------- */

export function CampaignGame(p: {
  active: boolean;
  settings: Settings;
  rep: RepMeta;
  line: Line;
  rival: string;
  level: number;
  playerName: string;
  maia: () => Maia;
  restore?: GameSnap;
  onSnapshot(s: GameSnap): void;
  onEnd(e: GameEnd): void;
}) {
  const pRef = useRef(p);
  pRef.current = p;
  const cg = useRef<Api | null>(null);
  const sess = useRef<Session | null>(null);
  const engine = useRef<Engine | null>(null);
  const [, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const [promo, setPromo] = useState<{ orig: Key; dest: Key } | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [engineErr, setEngineErr] = useState(false);
  const wake = useRef<any>(null);
  const trainRef = useRef<HTMLDivElement>(null);
  const movesRef = useRef<HTMLElement>(null);
  const ended = useRef(false);
  useBoardFit(trainRef);

  function sync() {
    const api = cg.current, se = sess.current;
    if (!api || !se) return;
    const live = se.started && se.phase !== 'over';
    if (!live) api.cancelMove();
    const c = se.chess;
    const last = se.played[se.played.length - 1];
    api.set({
      fen: c.fen(),
      orientation: colorName(se.cfg.userColor),
      turnColor: colorName(c.turn()),
      lastMove: last ? ([last.uci.slice(0, 2), last.uci.slice(2, 4)] as Key[]) : undefined,
      check: c.inCheck() ? colorName(c.turn()) : false,
      movable: { free: false, color: live ? colorName(se.cfg.userColor) : undefined, dests: se.userTurn ? destsOf(c) : new Map(), showDests: true },
      premovable: { enabled: live && se.phase === 'bot' },
      highlight: { lastMove: true, check: true, custom: new Map() },
    });
  }

  function releaseWake() {
    try { wake.current?.release?.(); } catch { /* ignore */ }
    wake.current = null;
  }

  function finished() {
    const se = sess.current;
    if (!se || !se.result || ended.current) return;
    ended.current = true;
    const x = pRef.current;
    const resigned = se.termination === 'Abandono';
    const game: NewGame = {
      repId: x.rep.id, repName: x.rep.name, lineId: x.line.id, lineEvent: x.line.event, lineWhite: x.line.white, lineBlack: x.line.black,
      userColor: se.cfg.userColor, botId: se.cfg.bot.id, botName: se.cfg.bot.name, botElo: se.cfg.elo,
      result: se.result, termination: se.termination ?? '', timeControl: `${CAMPAIGN.baseMin * 60}+${CAMPAIGN.incSec}`,
      ...(x.line.fen ? { startFen: x.line.fen } : {}),
      sans: se.played.map((m) => m.san), clocks: se.played.map((m) => Math.round(m.clock)),
      linePlies: se.lineMoves.length, lineErrors: 0, mode: 'campaign',
    };
    x.onEnd({ result: se.outcome!, moves: se.chess.moveNumber(), resigned, game });
  }

  useEffect(() => {
    const x = pRef.current;
    const trayner = BOTS.find((b) => b.human) ?? BOTS[0];
    let maia: Maia | null = null;
    try { maia = x.maia(); maia.load().catch(() => {}); } catch { maia = null; }
    let eng: Engine | null = null;
    try { eng = engine.current = new Engine(); } catch { eng = null; }
    const se = new Session(
      {
        line: x.line, userColor: x.rep.color, bot: { ...trayner, name: x.rival }, elo: x.level,
        baseMs: CAMPAIGN.baseMin * 60_000, incMs: CAMPAIGN.incSec * 1000, botMoveMs: x.settings.botMoveSec * 1000,
        startMove: 1, preplayLine: true,
      },
      eng,
      {
        change: bump,
        move(m, by) {
          const api = cg.current;
          if (api && by !== 'user') api.move(m.from as Key, m.to as Key);
          if (m.san.includes('+') || m.san.includes('#')) sound.check();
          else if (m.flags.includes('k') || m.flags.includes('q')) sound.castle();
          else if (m.captured) sound.capture();
          else sound.move();
          sync();
          if (sess.current && sess.current.phase !== 'over') pRef.current.onSnapshot(sess.current.snapshot());
          if (by === 'bot') setTimeout(() => cg.current?.playPremove(), 30);
        },
        wrong() { /* the line is already played */ },
        phase() { /* the game starts at once */ },
        end() { sync(); sound.end(); releaseWake(); setTimeout(finished, 300); },
        engineError() { setEngineErr(true); },
        draw(kind) {
          setBanner(kind === 'declined' ? `${x.rival} rechaza las tablas.` : `${x.rival} te ofrece tablas.`);
          setTimeout(() => setBanner(null), 3000);
        },
      },
      maia,
    );
    if (x.restore) se.restore(x.restore);
    sess.current = se;
    sync();
    bump();
    const tick = setInterval(() => sess.current?.tick(), 100);
    (window as any).__campaignGame = () => {
      const s = sess.current;
      if (!s) return null;
      return {
        started: s.started, phase: s.phase, userTurn: s.userTurn, moveNo: s.chess.moveNumber(), fen: s.chess.fen(),
        legal: s.userTurn ? s.chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')) : [],
        result: s.result ?? null,
      };
    };
    return () => {
      clearInterval(tick);
      se.destroy();
      engine.current?.destroy();
      engine.current = null;
      releaseWake();
    };
  }, []);

  useEffect(() => {
    const el = movesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    el.scrollLeft = el.scrollWidth;
    el.classList.toggle('overflowing', el.scrollWidth > el.clientWidth + 1);
  });

  function begin() {
    const se = sess.current;
    if (!se || se.started) return;
    se.start();
    sync();
    bump();
    try { (navigator as any).wakeLock?.request('screen').then((w: any) => { wake.current = w; }).catch(() => {}); } catch { /* not available */ }
  }

  function commit(uci: string) {
    const se = sess.current;
    if (!se) return;
    const res = se.userMove(uci);
    if (res !== 'ok') sync();
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

  const s = sess.current;
  const ready = !!s && !s.started;
  const over = s?.phase === 'over';
  const userColor = p.rep.color;
  const oppColor = userColor === 'w' ? 'b' : 'w';
  const rows = useMemo(() => buildRows(s?.played ?? [], s?.startFen, s?.linePlies ?? 0), [s?.played.length, s]);
  const early = !!s && s.chess.moveNumber() < CAMPAIGN.minResignMove;

  return (
    <div class={`train camp-game ${ready ? 'is-ready' : ''}`} ref={trainRef}>
      <div class="board-col">
        <PlayerStrip top name={p.rival} elo={p.level} side={oppColor} session={s} thinking={!!s?.thinking} />
        <div class="board-area">
          <Board
            theme={p.settings.boardTheme}
            coords={p.settings.coords}
            active={p.active}
            onReady={(api) => { cg.current = api; sync(); }}
            config={{ movable: { free: false, events: { after: onUserMove } }, premovable: { enabled: false, events: {} } }}
          />
          {ready && (
            <div class="ready-layer">
              <div class="ready-card">
                <button type="button" class="btn primary start-btn" onClick={begin}><Icon name="play" size={18} />{p.restore?.moves.length ? 'Continuar la partida' : 'Comenzar la partida'}</button>
                <span class="ready-sub">Campaña · {p.rival} ({p.level}) · {CAMPAIGN.baseMin}+{CAMPAIGN.incSec}</span>
              </div>
            </div>
          )}
          {promo && (
            <div class="promo" role="dialog" aria-label="Elige la pieza de coronación">
              <div class="promo-card">
                <span class="promo-title">Coronar como</span>
                <div class="cg-wrap promo-row">
                  {(['q', 'r', 'b', 'n'] as const).map((role) => (
                    <button type="button" class="promo-piece" aria-label={{ q: 'Dama', r: 'Torre', b: 'Alfil', n: 'Caballo' }[role]} onClick={() => choosePromo(role)}>
                      <piece class={`${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[role]} ${colorName(userColor)}`} />
                    </button>
                  ))}
                </div>
                <button type="button" class="btn ghost small" onClick={() => choosePromo(null)}>Cancelar</button>
              </div>
            </div>
          )}
          {banner && <div class="banner" role="status">{banner}</div>}
        </div>
        <PlayerStrip name={p.playerName || 'Tú'} side={userColor} session={s} thinking={false} />
      </div>

      <aside class={`side-col ${confirmResign ? 'confirming' : ''} ${s?.drawOffer === 'bot' ? 'offering' : ''}`}>
        <section class={`status-card phase-${ready ? 'ready' : over ? 'over' : 'bot'}`}>
          <div class="status-head">
            <span class="pill blue"><span class="lbl-long">Campaña · Partida</span><span class="lbl-short">Partida</span></span>
            <span class="rep-name" title={p.rep.name}>{p.rep.name}</span>
            <span class="tc" title="Ritmo de juego"><Icon name="clock" size={14} />{CAMPAIGN.baseMin}+{CAMPAIGN.incSec}</span>
          </div>
          {s?.drawOffer === 'bot' ? (
            <div class="draw-offer" role="group" aria-label="Oferta de tablas">
              <span class="status-text"><span class="lbl-long">{p.rival} te ofrece tablas.</span><span class="lbl-short">¿Tablas?</span></span>
              <button type="button" class="btn primary small" onClick={() => sess.current?.acceptDraw()}>Aceptar</button>
              <button type="button" class="btn ghost small" onClick={() => sess.current?.declineDraw()}>Seguir</button>
            </div>
          ) : (
            <p class="status-text">
              {ready ? <><span class="lbl-long">La línea ya está jugada: la partida empieza aquí.</span><span class="lbl-short">Lista</span></>
                : over ? <span>Partida terminada.</span>
                : s?.drawOffer === 'user' ? <><span class="lbl-long">Tablas ofrecidas: responderá con su jugada.</span><span class="lbl-short">Tablas ofrecidas…</span></>
                : s?.thinking ? <><span class="lbl-long">{p.rival} está pensando…</span><span class="lbl-short">Pensando…</span></>
                : 'Tu turno.'}
              {engineErr && <span class="err-count"> El motor no pudo cargarse en este dispositivo.</span>}
            </p>
          )}
        </section>

        <section class="moves" aria-label="Jugadas" ref={movesRef}>
          {rows.map((r) => (
            <div class="move-row">
              <span class="mno">{r.no}.</span>
              <span class={`mv ${r.wc}`}>{r.w?.san ?? (r.w === null ? '…' : '')}</span>
              <span class={`mv ${r.bc}`}>{r.b?.san ?? ''}</span>
            </div>
          ))}
        </section>

        <section class="actions">
          {!ready && !over && !confirmResign && (
            <>
              <button type="button" class="btn ghost" onClick={() => sess.current?.offerDraw()} disabled={!s?.canOfferDraw} title="Ofrecer tablas" aria-label="Ofrecer tablas"><span class="half" aria-hidden="true">½</span><span class="lbl-long">Tablas</span></button>
              <button type="button" class="btn ghost" onClick={() => setConfirmResign(true)}><Icon name="flag" size={18} />Abandonar</button>
            </>
          )}
          {confirmResign && (
            <div class="confirm">
              <span>
                <span class="lbl-long">{early ? `Antes de la jugada ${CAMPAIGN.minResignMove}, abandonar no cuenta para la racha. ¿Abandonar?` : '¿Abandonar la partida?'}</span>
                <span class="lbl-short">{early ? 'Sin racha. ¿Abandonar?' : '¿Abandonar?'}</span>
              </span>
              <button type="button" class="btn danger small" onClick={() => { setConfirmResign(false); sess.current?.resign(); }}>Sí, abandonar</button>
              <button type="button" class="btn ghost small" onClick={() => setConfirmResign(false)}>Seguir</button>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

/* ---------------- the day's result ---------------- */

export function CampaignResultSheet(p: {
  local: CampaignLocal;
  view: CampaignView | null;
  today: string;
  saving: boolean;
  error: string | null;
  onRetry(): void;
  onClose(): void;
  onGames(): void;
  onAtlas(): void;
}) {
  const f = p.local.finish;
  const o: CampaignOutcome | undefined = p.local.outcome;
  const st = p.view ? streakToday(p.view.streak, p.today) : null;
  if (!f) return null;
  return (
    <div class="sheet-backdrop">
      <div class="sheet camp-result" role="dialog" aria-label="Resultado de la Campaña">
        <div class={`sheet-result ${f.result}`}>
          <span class="eyebrow">Campaña · {p.local.rival}</span>
          <span class="result-big">{RESULT_TEXT[f.result]}</span>
          {o && <span class="result-sub">Rival {o.before} → <b>{o.after}</b>{o.after > o.before ? ' · sube' : o.after < o.before ? ' · baja' : ''}</span>}
        </div>
        <dl class="nt-facts camp-facts">
          <div><dt>Memoria</dt><dd>{p.local.nota !== null ? notaText(p.local.nota) : '—'}</dd></div>
          <div><dt>Fails</dt><dd>{p.local.fails}</dd></div>
          <div><dt>Jugadas</dt><dd>{f.moves}</dd></div>
          <div><dt>Racha</dt><dd>{st ? st.cur : '—'}</dd></div>
          <div><dt>Treguas</dt><dd>{st ? st.truces : '—'}</dd></div>
        </dl>
        {p.saving && <div class="save-ask"><p class="save-msg"><span class="spinner small" />Guardando…</p></div>}
        {p.error && (
          <div class="save-ask">
            <p class="save-msg bad">{p.error}</p>
            <button type="button" class="btn ghost small" onClick={p.onRetry}><Icon name="refresh" size={16} />Reintentar</button>
          </div>
        )}
        {o && (
          <ul class="camp-notes">
            {o.streakCounted && <li class="good"><Icon name="check" size={16} />Racha: {st ? dias(st.cur) : 'sumada'}.</li>}
            {!o.counted && <li class="bad"><Icon name="x" size={16} />Abandono antes de la jugada {CAMPAIGN.minResignMove}: hoy no suma racha.</li>}
            {o.counted && !o.streakCounted && <li><Icon name="check" size={16} />La racha de hoy ya estaba hecha en otro repertorio.</li>}
            {o.truceEarned && <li class="good"><Icon name="medal" size={16} />Tregua nueva: cubre un día sin Campaña.</li>}
            {o.rewardEarned === 'board-campana' && <li class="good"><Icon name="medal" size={16} />Tablero «Campaña» desbloqueado (en Ajustes).</li>}
            {o.rivalNew && <li class="good"><Icon name="medal" size={16} />{p.local.rival} entra en tu colección de rivales.</li>}
          </ul>
        )}
        <div class="sheet-foot">
          <button type="button" class="btn ghost" onClick={p.onGames}><Icon name="archive" size={18} />Ver partida</button>
          <button type="button" class="btn ghost" onClick={p.onAtlas}><Icon name="medal" size={18} />Atlas</button>
          <button type="button" class="btn primary" onClick={p.onClose} disabled={p.saving}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
