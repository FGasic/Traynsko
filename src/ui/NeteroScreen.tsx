import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Chess, SQUARES, type Move, type Square } from 'chess.js';
import { Board } from './Board';
import { Icon } from './parts';
import { RecordFacts, TopThree } from './Atlas';
import type { AwardResult } from './TrainScreen';
import type { Line, RepMeta, Repertoire } from '../../shared/types';
import { lineFingerprint } from '../../shared/atlas';
import { localDay, notaText, recordFor, topKey, type NeteroRecord, type NeteroScope, type NeteroState, type NeteroSummary } from '../../shared/netero';
import { CAMPAIGN, type CampaignFinish, type CampaignOutcome, type CampaignView } from '../../shared/campaign';
import { lineKey } from '../../shared/picks';
import { CampaignCard, CampaignGame, CampaignResultSheet, type GameEnd } from './Campaign';
import { liveCampaign, type CampaignLocal } from '../lib/campaign';
import type { Maia } from '../lib/maia';
import type { SaveResult } from './TrainScreen';
import { randomRival, rememberRival } from '../lib/rivals';
import {
  NeteroRun, deviceKind, fmtDuration, fmtSec, planCampaign, planErrors, planFromKeys, planFull,
  type FailEntry, type LineEnd, type Plan,
} from '../lib/netero';
import type { NeteroResult } from '../lib/api';
import { prefs, type Settings } from '../lib/prefs';
import { sound } from '../lib/sound';
import { useBoardFit } from '../lib/fit';
import { START_FEN } from '../lib/pgn';

interface Props {
  /** the Netero tab is on screen (leaving it pauses the session) */
  active: boolean;
  worldId: string;
  worldName: string;
  settings: Settings;
  reps: Repertoire[];
  /** lines left out of training (Biblioteca) */
  off: Set<string>;
  linesLoaded: boolean;
  playerName: string;
  account: boolean;
  /** the Lichess id of the account (to mark its place in a Top 3) */
  userId: string | null;
  signingIn: boolean;
  /** records, best times, review queue and Top 3 lists (null: no account, or not loaded yet) */
  netero: NeteroState | null;
  neteroError: string | null;
  onRetryLoad(): void;
  medalFps: Set<string>;
  onAwardMedal(rep: RepMeta, line: Line): Promise<AwardResult>;
  /** Saves a finished session (account only). Throws with a message when it fails. */
  onSave(s: NeteroSummary): Promise<NeteroResult>;
  onUpdateSettings(p: Partial<Settings>): void;
  onLogin(): void;
  goTo(tab: string): void;
  /** the Campaign: its state on the server (null: no account, or not loaded yet) */
  campaign: CampaignView | null;
  campaignError: string | null;
  onRetryCampaign(): void;
  /** Sends the day's game result; resolves with the server's answer. */
  onFinishCampaign(f: CampaignFinish): Promise<CampaignOutcome>;
  onSaveGame(g: GameEnd['game']): Promise<SaveResult>;
  /** the network behind Trayner, shared with Entrenar */
  maia: () => Maia;
}

/** The rival's reply of the line, and the first move of a line. */
const AUTO_MS = 320;
const AUTO_FIRST_MS = 480;
/** The pause between lines, long enough to read the banner. */
const BETWEEN_MS = { clean: 1100, repeat: 1700, finish: 700 };

const MODE_NAME = { full: 'Netero completo', daily: 'Netero diario', errors: 'Repetir errores', campaign: 'Campaña · memoria' } as const;
const colorName = (c: 'w' | 'b') => (c === 'w' ? 'white' : 'black');

function destsOf(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const s of SQUARES) {
    const ms = chess.moves({ square: s, verbose: true });
    if (ms.length) dests.set(s as Key, ms.map((m) => m.to as Key));
  }
  return dests;
}

type Report = {
  plan: Plan;
  summary: NeteroSummary;
  score: { nota: number; precision: number; ritmo: number; meanMs: number };
  fails: FailEntry[];
  state: 'saving' | 'saved' | 'error' | 'guest';
  result?: NeteroResult;
  message?: string;
};

type Banner = { text: string; kind: 'good' | 'bad' | 'info' };

export function NeteroScreen(p: Props) {
  const pRef = useRef(p);
  pRef.current = p;
  const cg = useRef<Api | null>(null);
  const run = useRef<NeteroRun | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const best = useRef<Record<string, number>>({});
  const [, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const [flash, setFlash] = useState(0);
  const [banner, setBannerState] = useState<Banner | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [promo, setPromo] = useState<{ orig: Key; dest: Key } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [saved, setSaved] = useState(() => prefs.netero(p.worldId));
  const [hintMove, setHintState] = useState<string | null>(null);
  const hintRef = useRef<string | null>(null);
  const setHintMove = (v: string | null) => { hintRef.current = v; setHintState(v); };
  const wake = useRef<any>(null);
  const trainRef = useRef<HTMLDivElement>(null);
  const movesRef = useRef<HTMLElement>(null);
  useBoardFit(trainRef);

  const r = run.current;

  /* ---------- what can be played ---------- */
  const worldScope: NeteroScope = { kind: 'world', id: p.worldId, name: p.worldName };
  const scopes = useMemo(() => {
    const list: { scope: NeteroScope; plan: Plan }[] = [{ scope: worldScope, plan: planFull(p.reps, p.off, worldScope) }];
    if (p.reps.length > 1) for (const rep of p.reps) {
      const scope: NeteroScope = { kind: 'rep', id: rep.id, name: rep.name };
      list.push({ scope, plan: planFull(p.reps, p.off, scope) });
    }
    return list;
  }, [p.reps, p.off, p.worldId, p.worldName]);
  const records = p.netero?.records ?? [];
  const today = localDay();
  // the Campaign kept on this device: today's (or yesterday's, if it is still being played)
  const [camp, setCampState] = useState<CampaignLocal | null>(() => liveCampaign(prefs.campaign(p.worldId), p.worldId, localDay()));
  const campRef = useRef(camp);
  campRef.current = camp;
  const setCamp = (c: CampaignLocal | null) => { campRef.current = c; prefs.saveCampaign(pRef.current.worldId, c); setCampState(c); };
  const [showGame, setShowGame] = useState(false);
  const [memoryDone, setMemoryDone] = useState<{ nota: number; fails: number; list: FailEntry[] } | null>(null);
  const [campSave, setCampSave] = useState<{ saving: boolean; error: string | null; open: boolean }>({ saving: false, error: null, open: false });

  // a session saved on this device: it can be resumed while its lines are still in the repertoire
  const resumable = useMemo(() => {
    if (!saved || !p.linesLoaded || run.current || saved.mode === 'campaign') return null;
    return NeteroRun.restore(saved, p.reps);
  }, [saved, p.linesLoaded, p.reps, r]);

  /* ---------- board ---------- */
  function sync() {
    const api = cg.current, x = run.current;
    if (!api || !x) return;
    if (!x.userTurn) api.cancelMove();
    api.set({
      fen: x.chess.fen(),
      orientation: colorName(x.color),
      turnColor: colorName(x.chess.turn()),
      lastMove: x.lastMove as Key[] | undefined,
      check: x.chess.inCheck() ? colorName(x.chess.turn()) : false,
      movable: { free: false, color: x.status === 'play' && !x.paused ? colorName(x.color) : undefined, dests: x.userTurn ? destsOf(x.chess) : new Map(), showDests: true },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true, custom: new Map() },
    });
    paintHint();
  }

  function paintHint() {
    const api = cg.current, x = run.current, h = hintRef.current;
    if (!api) return;
    const valid = !!h && !!x && x.userTurn && x.expected === h;
    if (h && !valid) { hintRef.current = null; setHintState(null); }
    api.setAutoShapes(valid ? [{ orig: h!.slice(0, 2) as Key, dest: h!.slice(2, 4) as Key, brush: 'green' }] : []);
  }

  function showBanner(b: Banner | null, ms = 1600) {
    clearTimeout(bannerTimer.current);
    setBannerState(b);
    if (b) bannerTimer.current = setTimeout(() => setBannerState(null), ms);
  }

  /* ---------- keeping it on the device ---------- */
  function persist() {
    const x = run.current;
    if (!x || x.status === 'done' || x.status === 'ready') return;
    prefs.saveNetero(pRef.current.worldId, x.snapshot());
  }
  function forget() {
    prefs.saveNetero(pRef.current.worldId, null);
    setSaved(null);
  }

  /* ---------- the driver: the rival's moves and the pause between lines ---------- */
  function drive() {
    clearTimeout(timer.current);
    timer.current = undefined;
    const x = run.current;
    if (!x || x.paused) return;
    if (x.status === 'play' && x.autoDue) {
      timer.current = setTimeout(() => {
        const res = x.autoMove();
        if (!res) return;
        const api = cg.current;
        if (api) api.move(res.move.from as Key, res.move.to as Key);
        moveSound(res.move);
        after(res.end);
      }, x.ply === 0 ? AUTO_FIRST_MS : AUTO_MS);
    } else if (x.status === 'between' && x.lastEnd) {
      const e = x.lastEnd;
      timer.current = setTimeout(() => {
        const step = x.next();
        if (step === 'finish') finish();
        else if (step) { sync(); persist(); drive(); bump(); }
      }, e.next === 'finish' ? BETWEEN_MS.finish : e.clean ? BETWEEN_MS.clean : BETWEEN_MS.repeat);
    }
  }

  function moveSound(m: Move) {
    if (m.san.includes('+') || m.san.includes('#')) sound.check();
    else if (m.flags.includes('k') || m.flags.includes('q')) sound.castle();
    else if (m.captured) sound.capture();
    else sound.move();
  }

  /** After any move: the board, the line's end if it came, the device copy and the next step. */
  function after(end?: LineEnd) {
    setHintMove(null);
    sync();
    if (end) lineEnded(end);
    persist();
    drive();
    bump();
  }

  function lineEnded(e: LineEnd) {
    const x = run.current!;
    const item = x.item;
    if (!e.clean) { sound.wrong(); showBanner({ text: 'Con errores: repítela desde el principio, sin fallos.', kind: 'bad' }, BETWEEN_MS.repeat + 300); return; }
    sound.phase();
    let text = e.pass > 1 ? 'Repetición limpia.' : 'Línea perfecta.';
    if (e.avgMs !== null) {
      const prev = best.current[e.key];
      text += ` ${fmtSec(e.avgMs)}/jug`;
      if (prev !== undefined) {
        const d = e.avgMs - prev;
        text += ` (${d <= 0 ? '−' : '+'}${fmtSec(Math.abs(d)).replace(' s', '')} s)`;
      }
      if (prev === undefined || e.avgMs < prev) best.current[e.key] = e.avgMs;
      showBanner({ text, kind: prev === undefined ? 'good' : e.avgMs <= prev ? 'good' : 'bad' }, BETWEEN_MS.clean + 500);
    } else {
      showBanner({ text, kind: 'good' }, BETWEEN_MS.clean + 300);
    }
    // the first clean pass of a line earns its emblem, if the player didn't have it yet
    if (e.pass === 1 && pRef.current.account && !pRef.current.medalFps.has(lineFingerprint(item.rep.color, item.line))) {
      pRef.current.onAwardMedal(item.rep, item.line).catch(() => { /* the line is still done; the Atlas shows what was saved */ });
    }
  }

  /* ---------- sessions ---------- */
  function start(plan: Plan) {
    clearTimeout(timer.current);
    if (!plan.lines.length) return;
    forget();
    setReport(null);
    setConfirmQuit(false);
    setHintMove(null);
    showBanner(null);
    best.current = { ...(pRef.current.netero?.best ?? {}) };
    run.current = new NeteroRun(plan, pRef.current.worldId);
    sync();
    bump();
  }

  /** «Comenzar»: the clock starts. */
  function begin() {
    const x = run.current;
    if (!x || x.status !== 'ready') return;
    x.begin();
    persist();
    sync();
    drive();
    bump();
    try { (navigator as any).wakeLock?.request('screen').then((w: any) => { wake.current = w; }).catch(() => {}); } catch { /* not available */ }
  }

  function resumeSaved() {
    if (!resumable) return;
    best.current = { ...(pRef.current.netero?.best ?? {}) };
    run.current = resumable;
    setReport(null);
    sync();
    bump();
  }

  function pause() {
    const x = run.current;
    if (!x || x.paused || x.status === 'done' || x.status === 'ready') return;
    clearTimeout(timer.current);
    timer.current = undefined;
    x.pause();
    cg.current?.cancelMove();
    setPromo(null);
    persist();
    sync();
    bump();
  }

  function resume() {
    const x = run.current;
    if (!x || !x.paused) return;
    x.resume();
    sync();
    drive();
    bump();
  }

  /** Leave a session: in the Campaign's memory phase, the day's Campaign goes too (it can be started again). */
  function quit() {
    if (run.current?.plan.mode === 'campaign' && campRef.current?.phase === 'memory') setCamp(null);
    closeRun();
  }

  function closeRun() {
    clearTimeout(timer.current);
    run.current = null;
    cg.current = null;   // the board goes away with the session
    forget();
    setConfirmQuit(false);
    setReport(null);
    setPromo(null);
    showBanner(null);
    releaseWake();
    bump();
  }

  function releaseWake() {
    try { wake.current?.release?.(); } catch { /* ignore */ }
    wake.current = null;
  }

  function finish() {
    const x = run.current;
    if (!x) return;
    forget();
    releaseWake();
    sound.end();
    sync();
    const summary = x.summary(deviceKind(), localDay());
    const live = x.live;
    if (x.plan.mode === 'campaign') { memoryPhaseDone(x, summary); return; }
    const rep: Report = {
      plan: x.plan, summary,
      score: { nota: live.nota, precision: live.precision, ritmo: live.ritmo, meanMs: live.nodes ? live.thinkMs / live.nodes : 0 },
      fails: x.failList,
      state: pRef.current.account ? 'saving' : 'guest',
    };
    setReport(rep);
    bump();
    if (pRef.current.account) save(rep);
  }

  /* ---------- the Campaign ---------- */
  function startCampaign(startLevel?: number) {
    const v = pRef.current.campaign;
    if (!v) return;
    const plan = planCampaign(pRef.current.reps, pRef.current.off, pRef.current.netero?.queue ?? []);
    if (!plan.lines.length) return;
    setCamp({
      v: 1, worldId: pRef.current.worldId, day: localDay(), phase: 'memory', lines: plan.lines.map((x) => x.key),
      nota: null, fails: 0, gameLine: null, rival: '', level: v.campaign?.level ?? startLevel ?? CAMPAIGN.startDefault,
      ...(v.campaign ? {} : { start: startLevel ?? CAMPAIGN.startDefault }),
    });
    start(plan);
  }

  function continueCampaign() {
    const c = campRef.current;
    if (!c) return;
    if (c.phase === 'memory') {
      const snap = prefs.netero(pRef.current.worldId);
      const back = snap && snap.mode === 'campaign' ? NeteroRun.restore(snap, pRef.current.reps) : null;
      if (back) { best.current = { ...(pRef.current.netero?.best ?? {}) }; run.current = back; setReport(null); sync(); bump(); return; }
      const plan = planFromKeys(pRef.current.reps, c.lines, 'campaign');
      if (plan.lines.length) start(plan); else setCamp(null);
      return;
    }
    if (c.phase === 'game') { setShowGame(true); return; }
    if (c.phase === 'saving') { setShowGame(true); sendFinish(); }
  }

  /** The memory phase is over: the game's line and rival are drawn, and the result goes to the server in the background. */
  function memoryPhaseDone(x: NeteroRun, summary: NeteroSummary) {
    const live = x.live;
    const keys = x.plan.lines.map((l) => l.key);
    const recent = prefs.recentRivals();
    const rival = randomRival(recent);
    prefs.saveRecentRivals(rememberRival(recent, rival));
    const c = campRef.current;
    setCamp({
      ...(c ?? { v: 1, worldId: pRef.current.worldId, day: localDay(), lines: keys, level: CAMPAIGN.startDefault }),
      phase: 'game', nota: live.nota, fails: x.fails, gameLine: keys[Math.floor(Math.random() * keys.length)], rival, game: undefined,
    } as CampaignLocal);
    setMemoryDone({ nota: live.nota, fails: x.fails, list: x.failList });
    if (pRef.current.account) pRef.current.onSave(summary).catch(() => { /* best times and the review queue: not essential */ });
    bump();
  }

  function playCampaignGame() {
    setMemoryDone(null);
    closeRun();
    setShowGame(true);
  }

  function gameEnded(e: GameEnd) {
    const c = campRef.current;
    if (!c) return;
    setCamp({ ...c, phase: 'saving', finish: { result: e.result, moves: e.moves, resigned: e.resigned }, game: undefined });
    pRef.current.onSaveGame(e.game).catch(() => { /* the Campaign's result still goes */ });
    sendFinish();
  }

  async function sendFinish() {
    const c = campRef.current;
    if (!c?.finish) return;
    setCampSave({ saving: true, error: null, open: true });
    try {
      const outcome = await pRef.current.onFinishCampaign({ day: c.day, ...c.finish, rival: c.rival, nota: c.nota, ...(c.start ? { start: c.start } : {}) });
      setCamp({ ...campRef.current!, phase: 'done', outcome });
      setCampSave({ saving: false, error: null, open: true });
    } catch (e: any) {
      if (e?.code === 'campaign_done') { setCamp({ ...campRef.current!, phase: 'done' }); setCampSave({ saving: false, error: null, open: true }); }
      else setCampSave({ saving: false, error: e?.message ?? 'No se pudo guardar la Campaña.', open: true });
    }
  }

  function closeCampaignResult() {
    setCampSave({ saving: false, error: null, open: false });
    setShowGame(false);
  }

  async function save(rep: Report) {
    setReport({ ...rep, state: 'saving', message: undefined });
    try {
      const result = await pRef.current.onSave(rep.summary);
      setReport((cur) => (cur && cur.summary === rep.summary ? { ...cur, state: 'saved', result } : cur));
    } catch (e: any) {
      setReport((cur) => (cur && cur.summary === rep.summary ? { ...cur, state: 'error', message: e?.message ?? 'No se pudo guardar la sesión.' } : cur));
    }
  }

  /* ---------- the player's moves ---------- */
  function commit(uci: string) {
    const x = run.current;
    if (!x) return;
    const res = x.userMove(uci);
    if (res.kind === 'wrong') {
      sound.wrong();
      setFlash((f) => f + 1);
      const api = cg.current;
      if (api) {
        api.set({ highlight: { lastMove: true, check: true, custom: new Map([[uci.slice(2, 4) as Key, 'wrong']]) } });
        setTimeout(() => sync(), 260);
      }
      persist();
      bump();
      return;
    }
    if (res.kind === 'ignored') { sync(); return; }
    moveSound(res.move);
    after(res.end);
  }

  function onUserMove(orig: Key, dest: Key) {
    const x = run.current;
    if (!x) return;
    const piece = x.chess.get(orig as Square);
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
    const mv = run.current?.hint();
    if (!mv) return;
    setHintMove(mv);
    paintHint();
  }

  /* ---------- automatic pause: another tab, another app, another window ---------- */
  useEffect(() => { if (!p.active) pause(); }, [p.active]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') pause(); };
    const blur = () => pause();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', blur);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', blur);
      clearTimeout(timer.current);
      clearTimeout(bannerTimer.current);
      releaseWake();
    };
  }, []);
  // read-only hook for automated checks
  useEffect(() => {
    (window as any).__neteroState = () => {
      const x = run.current;
      return x ? { status: x.status, paused: x.paused, idx: x.idx, total: x.total, pass: x.pass, fails: x.fails, expected: x.userTurn ? x.expected : null, fen: x.chess.fen(), nodes: x.live.nodes, nota: x.live.nota, elapsed: x.elapsedMs } : null;
    };
  }, []);

  useEffect(() => {
    const el = movesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    el.scrollLeft = el.scrollWidth;
    el.classList.toggle('overflowing', el.scrollWidth > el.clientWidth + 1);
  });

  /* ---------- render ---------- */
  if (!p.linesLoaded) {
    return <div class="netero-lobby"><div class="page-inner"><div class="loading"><div class="spinner" />Preparando tu repertorio…</div></div></div>;
  }

  if (showGame && camp?.gameLine && camp.phase !== 'memory') {
    const item = gameItem(p.reps, camp.gameLine);
    if (!item) {
      return (
        <div class="netero-lobby"><div class="page-inner">
          <div class="empty">
            <h2>La línea de la partida ya no está</h2>
            <p>El repertorio cambió desde que empezaste esta Campaña. Puedes empezarla de nuevo.</p>
            <button type="button" class="btn primary" onClick={() => { setCamp(null); setShowGame(false); }}>Volver</button>
          </div>
        </div></div>
      );
    }
    return (
      <>
        <CampaignGame
          key={`${camp.day}:${camp.gameLine}`}
          active={p.active}
          settings={p.settings}
          rep={item.rep}
          line={item.line}
          rival={camp.rival}
          level={camp.level}
          playerName={p.playerName}
          maia={p.maia}
          restore={camp.game}
          onSnapshot={(g) => { const c = campRef.current; if (c && c.phase === 'game') setCamp({ ...c, game: g }); }}
          onEnd={gameEnded}
        />
        {campSave.open && camp.finish && (
          <CampaignResultSheet
            local={camp}
            view={p.campaign}
            today={today}
            saving={campSave.saving}
            error={campSave.error}
            onRetry={sendFinish}
            onClose={closeCampaignResult}
            onGames={() => { closeCampaignResult(); p.goTo('games'); }}
            onAtlas={() => { closeCampaignResult(); p.goTo('atlas'); }}
          />
        )}
      </>
    );
  }

  if (!r) {
    return (
      <Lobby
        {...p}
        scopes={scopes}
        records={records}
        resumable={resumable}
        camp={camp}
        today={today}
        onStartCampaign={startCampaign}
        onContinueCampaign={continueCampaign}
        onResume={resumeSaved}
        onDiscard={forget}
        onStart={start}
      />
    );
  }

  const live = r.live;
  const scope = r.plan.scope;
  const rec = scope && r.plan.fp ? recordFor(records, scope, r.plan.fp).current : null;
  const ready = r.status === 'ready';
  const hintable = r.canHint && !hintMove;
  const meanMs = live.nodes ? live.thinkMs / live.nodes : 0;
  const recCell = r.plan.mode !== 'full' ? '—' : !r.plan.eligible ? 'Práctica' : rec ? notaText(rec.nota) : '—';
  const statusText = ready ? 'Pulsa «Comenzar» cuando quieras.'
    : r.paused ? 'En pausa.'
    : r.status === 'between' ? (r.lastEnd?.clean ? (r.lastEnd.next === 'finish' ? 'Sesión completada.' : 'Siguiente línea…') : 'Repetición obligatoria…')
    : r.status === 'done' ? 'Sesión completada.'
    : r.userTurn ? (r.pass > 1 ? 'Repetición: sin errores para avanzar.' : 'Tu turno.')
    : 'La línea responde…';
  const shortStatus = ready ? 'Lista' : r.paused ? 'Pausa' : r.status === 'between' ? '…' : r.userTurn ? (r.pass > 1 ? 'Repite' : 'Tu jugada') : 'Responde…';
  const rows = buildRows(r);

  return (
    <div class={`train netero ${ready ? 'is-ready' : ''}`} ref={trainRef}>
      <div class="board-col">
        <div class="player top">
          <div class="player-id">
            <span class="player-name nt-progress">Línea {Math.min(r.idx + 1, r.total)} / {r.total}</span>
            {r.pass > 1 && <span class="nt-pass" title="Repeticiones obligatorias de esta línea">Rep. {r.pass - 1}</span>}
          </div>
          <SessionClock run={r} />
        </div>
        <div class="board-area">
          <Board
            theme={p.settings.boardTheme}
            coords={p.settings.coords}
            flash={flash}
            active={p.active}
            onReady={(api) => { cg.current = api; sync(); }}
            config={{ movable: { free: false, events: { after: onUserMove } }, premovable: { enabled: false, events: {} } }}
          />
          {ready && (
            <div class="ready-layer">
              <div class="ready-card">
                <button type="button" class="btn primary start-btn" onClick={begin}><Icon name="play" size={18} />Comenzar</button>
                <span class="ready-sub">{MODE_NAME[r.plan.mode]}{scope ? ` · ${scope.kind === 'world' ? 'repertorio completo' : scope.name}` : ''} · {r.total === 1 ? '1 línea' : `${r.total} líneas`}</span>
                {r.plan.mode === 'full' && !r.plan.eligible && <span class="ready-sub nt-practice">Práctica: {r.plan.activeInScope} de {r.plan.inScope} líneas activas, sin récord</span>}
              </div>
            </div>
          )}
          {r.paused && r.status !== 'done' && (
            <div class="nt-pause" role="dialog" aria-label="Sesión en pausa">
              <div class="empty-card nt-pause-card">
                <span class="eyebrow">{MODE_NAME[r.plan.mode]}</span>
                <h2>En pausa</h2>
                <p>Línea {Math.min(r.idx + 1, r.total)} de {r.total} · {fmtDuration(r.elapsedMs)} · {r.fails} {r.fails === 1 ? 'fail' : 'fails'}</p>
                <div class="empty-actions">
                  <button type="button" class="btn primary" onClick={resume}><Icon name="play" size={18} />Continuar</button>
                  <button type="button" class="btn ghost" onClick={() => setConfirmQuit(true)}>Abandonar</button>
                </div>
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
                      <piece class={`${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[role]} ${colorName(r.color)}`} />
                    </button>
                  ))}
                </div>
                <button type="button" class="btn ghost small" onClick={() => choosePromo(null)}>Cancelar</button>
              </div>
            </div>
          )}
          {banner && <div class={`banner nt-banner ${banner.kind}`} role="status">{banner.text}</div>}
          {memoryDone && (
            <MemoryDoneSheet
              done={memoryDone}
              rival={camp?.rival ?? ''}
              level={camp?.level ?? CAMPAIGN.startDefault}
              onPlay={playCampaignGame}
              onLater={() => { setMemoryDone(null); closeRun(); }}
            />
          )}
          {report && (
            <ReportSheet
              report={report}
              account={p.account}
              signingIn={p.signingIn}
              onRetry={() => save(report)}
              onLogin={p.onLogin}
              onAgain={() => start(planErrors(p.reps, report.summary.failed))}
              onLobby={quit}
              onAtlas={() => { quit(); p.goTo('atlas'); }}
            />
          )}
        </div>
        <div class="player bottom">
          <div class="player-id"><span class="player-name">{p.playerName || 'Tú'}</span></div>
          <div class={`clock nt-fails ${r.fails ? 'has-fails' : ''}`} aria-label="Fails">{r.fails} <small>{r.fails === 1 ? 'fail' : 'fails'}</small></div>
        </div>
      </div>

      <aside class={`side-col netero-side ${confirmQuit ? 'confirming' : ''}`}>
        <section class={`status-card ${hintable ? 'has-hint' : ''}`}>
          <div class="status-head">
            <span class={`pill ${r.pass > 1 ? 'loss' : 'brass'}`}>
              <span class="lbl-long">{r.pass > 1 ? `Repetición ${r.pass - 1}` : MODE_NAME[r.plan.mode]}</span>
              <span class="lbl-short">{r.pass > 1 ? `Rep. ${r.pass - 1}` : 'Netero'}</span>
            </span>
            {scope && <span class="rep-name" title={scope.name}>{scope.kind === 'world' ? 'Repertorio completo' : scope.name}</span>}
          </div>
          <p class="status-text"><span class="lbl-long">{statusText}</span><span class="lbl-short">{shortStatus}</span></p>
          {hintable && <button type="button" class="btn ghost small" onClick={showHint}><Icon name="eye" size={16} /><span class="lbl-long">Ver la jugada</span><span class="lbl-short">Ver</span></button>}
        </section>

        <section class="nt-stats" aria-label="Marcador">
          <div class="nt-stat main"><b>{live.nodes ? notaText(live.nota) : '—'}</b><span>Nota en curso</span></div>
          <div class="nt-stat"><b>{recCell}</b><span>Récord</span></div>
          <div class="nt-stat"><b>{live.nodes ? `${Math.round(live.precision * 100)}%` : '—'}</b><span>Precisión</span></div>
          <div class="nt-stat"><b>{live.nodes ? fmtSec(meanMs) : '—'}</b><span>Ritmo / jug.</span></div>
        </section>

        <section class="moves" aria-label="Jugadas" ref={movesRef}>
          {rows.length === 0 && <p class="moves-empty">Las jugadas aparecerán aquí.</p>}
          {rows.map((row) => (
            <div class="move-row">
              <span class="mno">{row.no}.</span>
              <span class="mv line">{row.w ?? (row.w === null ? '…' : '')}</span>
              <span class="mv line">{row.b ?? ''}</span>
            </div>
          ))}
        </section>

        <section class="actions">
          {!confirmQuit && !ready && r.status !== 'done' && (
            <>
              <button type="button" class="btn ghost" onClick={pause} disabled={r.paused}><Icon name="pause" size={18} />Pausa</button>
              <button type="button" class="btn ghost" onClick={() => setConfirmQuit(true)}><Icon name="flag" size={18} /><span class="lbl-long">Abandonar</span><span class="lbl-short">Salir</span></button>
            </>
          )}
          {!confirmQuit && ready && <button type="button" class="btn ghost" onClick={quit}><Icon name="back" size={18} />Volver</button>}
          {confirmQuit && (
            <div class="confirm">
              <span><span class="lbl-long">¿Abandonar? No se guarda nada.</span><span class="lbl-short">¿Abandonar?</span></span>
              <button type="button" class="btn danger small" onClick={quit}>Sí, abandonar</button>
              <button type="button" class="btn ghost small" onClick={() => setConfirmQuit(false)}>Seguir</button>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

/* ---------- pieces ---------- */

function SessionClock({ run }: { run: NeteroRun }) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), 200); return () => clearInterval(t); }, []);
  const on = run.status === 'play' || run.status === 'between';
  return <div class={`clock nt-clock ${on && !run.paused ? 'active' : ''} ${run.status === 'ready' ? 'idle' : ''}`} aria-label="Tiempo de la sesión">{fmtDuration(run.elapsedMs)}</div>;
}

interface Row { no: number; w?: string | null; b?: string }
/** The moves of the current pass, numbered from the line's start position. */
function buildRows(x: NeteroRun): Row[] {
  const fen = x.item.line.fen ?? START_FEN;
  let no = Number(fen.split(' ')[5]) || 1;
  let turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const rows: Row[] = [];
  let cur: Row | null = null;
  for (const san of x.chess.history()) {
    if (turn === 'w') { cur = { no, w: san }; rows.push(cur); }
    else { if (!cur) { cur = { no, w: null }; rows.push(cur); } cur.b = san; no++; cur = null; }
    turn = turn === 'w' ? 'b' : 'w';
  }
  return rows;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Lobby(props: Props & {
  scopes: { scope: NeteroScope; plan: Plan }[];
  records: NeteroRecord[];
  resumable: NeteroRun | null;
  camp: CampaignLocal | null;
  today: string;
  onStartCampaign(start?: number): void;
  onContinueCampaign(): void;
  onResume(): void;
  onDiscard(): void;
  onStart(plan: Plan): void;
}) {
  const { scopes, records, resumable } = props;
  const [askDiscard, setAskDiscard] = useState(false);
  const activeLines = scopes[0].plan.lines.length;
  const locked = !!resumable;
  const me = props.userId ?? undefined;
  return (
    <div class="netero-lobby">
      <div class="page-inner">
        <header class="page-head">
          <div>
            <span class="eyebrow">Solo la apertura</span>
            <h1>Modo Netero</h1>
            <p class="lede">Juega cada línea desde la jugada 1. Si fallas, la repites desde el principio hasta hacerla sin errores. La primera pasada es el examen: solo ella puntúa.</p>
          </div>
        </header>

        <CampaignCard
          account={props.account}
          signingIn={props.signingIn}
          onLogin={props.onLogin}
          view={props.campaign}
          error={props.campaignError}
          onRetry={props.onRetryCampaign}
          local={props.camp}
          today={props.today}
          hasLines={activeLines > 0}
          onStart={props.onStartCampaign}
          onContinue={props.onContinueCampaign}
        />

        {resumable && (
          <section class="panel nt-resume" aria-label="Sesión en curso">
            <div class="nt-resume-text">
              <span class="eyebrow">Sesión en curso</span>
              <strong>{MODE_NAME[resumable.plan.mode]}{resumable.plan.scope ? ` · ${resumable.plan.scope.kind === 'world' ? 'repertorio completo' : resumable.plan.scope.name}` : ''}</strong>
              <span>Línea {Math.min(resumable.idx + 1, resumable.total)} de {resumable.total} · {fmtDuration(resumable.elapsedMs)} · {resumable.fails} {resumable.fails === 1 ? 'fail' : 'fails'}</span>
            </div>
            {!askDiscard ? (
              <div class="row-actions">
                <button type="button" class="btn primary" onClick={props.onResume}><Icon name="play" size={18} />Continuar</button>
                <button type="button" class="btn ghost" onClick={() => setAskDiscard(true)}>Abandonar</button>
              </div>
            ) : (
              <div class="confirm">
                <span>¿Abandonar? No se guarda nada.</span>
                <button type="button" class="btn danger small" onClick={() => { setAskDiscard(false); props.onDiscard(); }}>Sí, abandonar</button>
                <button type="button" class="btn ghost small" onClick={() => setAskDiscard(false)}>Seguir</button>
              </div>
            )}
          </section>
        )}

        {!props.account && (
          <div class="notice nt-guest">
            <span>Sin cuenta, Netero funciona pero no guarda récords, mejores marcas ni racha.</span>
            <button type="button" class="btn ghost small" onClick={props.onLogin} disabled={props.signingIn}><Icon name="login" size={16} />{props.signingIn ? 'Conectando…' : 'Entrar con Lichess'}</button>
          </div>
        )}
        {props.account && props.neteroError && <p class="notice bad">{props.neteroError} <button type="button" class="btn ghost small" onClick={props.onRetryLoad}>Reintentar</button></p>}

        {activeLines === 0 ? (
          <div class="empty">
            <h2>{props.reps.length ? 'Elige qué entrenar' : 'Aún no hay líneas aquí'}</h2>
            <p>{props.reps.length ? 'Todas las líneas de este repertorio están fuera del entrenamiento. Activa al menos una en la Biblioteca.' : 'Cuando haya líneas en este repertorio, podrás entrenarlas aquí.'}</p>
            {props.reps.length > 0 && <button type="button" class="btn primary" onClick={() => props.goTo('library')}>Ir a la Biblioteca</button>}
          </div>
        ) : (
          <>
            <section class="panel nt-card">
              <div class="panel-head">
                <h2 class="section-title">Netero completo</h2>
                <span class="hint-text">Un récord por alcance</span>
              </div>
              <ul class="nt-scopes">
                {scopes.map(({ scope, plan }) => {
                  const { current, previous } = plan.fp ? recordFor(records, scope, plan.fp) : { current: null, previous: null };
                  const top = plan.fp ? props.netero?.tops[topKey(scope.kind, plan.fp)] : undefined;
                  const playable = plan.lines.length;
                  return (
                    <li class="nt-scope">
                      <div class="nt-scope-id">
                        <b>{scope.kind === 'world' ? 'Repertorio completo' : scope.name}</b>
                        <small>
                          {plan.eligible ? `${plan.inScope} ${plan.inScope === 1 ? 'línea' : 'líneas'}` : `Práctica: ${plan.activeInScope} de ${plan.inScope} líneas activas`}
                        </small>
                      </div>
                      <div class="nt-scope-rec">
                        {current ? <><span class="nt-rec-nota">{notaText(current.nota)}</span><RecordFacts rec={current} /></>
                          : props.account && <span class="nt-rec-none">Sin récord</span>}
                        {!current && previous && <span class="nt-rec-prev">Versión anterior: {notaText(previous.nota)} ({fmtDate(previous.date)})</span>}
                      </div>
                      <button type="button" class="btn primary small" disabled={!playable || locked} onClick={() => props.onStart(planFull(props.reps, props.off, scope))}>
                        <Icon name="play" size={16} />Empezar
                      </button>
                      <TopThree entry={top} me={me} />
                    </li>
                  );
                })}
              </ul>
              {scopes[0].plan.eligible ? null : <p class="help">Con líneas desactivadas en la Biblioteca la sesión cuenta como práctica: muestra la nota, pero no genera récord.</p>}
            </section>
            {locked && <p class="help">Continúa o abandona la sesión en curso para empezar otra.</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** The memory phase of the Campaign is over: its nota and fails, then the game. */
function MemoryDoneSheet({ done, rival, level, onPlay, onLater }: {
  done: { nota: number; fails: number; list: FailEntry[] }; rival: string; level: number; onPlay(): void; onLater(): void;
}) {
  return (
    <div class="sheet-backdrop">
      <div class="sheet nt-report" role="dialog" aria-label="Memoria completada">
        <div class="sheet-result nt-result">
          <span class="eyebrow">Campaña · memoria completada</span>
          <span class="nt-nota">{notaText(done.nota)}</span>
          <span class="result-sub">{done.fails} {done.fails === 1 ? 'fail' : 'fails'} · ahora, la partida</span>
        </div>
        {done.list.length > 0 && (
          <div class="nt-fails-list">
            <span class="eyebrow">Jugadas falladas</span>
            <ul>
              {done.list.map((f) => (
                <li>
                  <MiniBoard fen={f.fen} color={f.color} good={f.expected} bad={f.played} />
                  <div class="nt-fail-text">
                    <span class="nt-fail-move">Correcta: <b>{f.expectedSan}</b></span>
                    <span class="nt-fail-played">Jugaste: {f.playedSan}{f.count > 1 ? ` · ×${f.count}` : ''}</span>
                    <small>{f.title}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div class="save-ask camp-next-game">
          <p class="save-msg">Una de las 3 líneas sigue contra <b>{rival}</b> ({level}), {CAMPAIGN.baseMin}+{CAMPAIGN.incSec}, desde donde termina la teoría.</p>
        </div>
        <div class="sheet-foot">
          <button type="button" class="btn ghost" onClick={onLater}>Más tarde</button>
          <button type="button" class="btn primary" onClick={onPlay}><Icon name="play" size={18} />Jugar la partida</button>
        </div>
      </div>
    </div>
  );
}

/** The line of the Campaign's game, by its key. */
function gameItem(reps: Repertoire[], key: string): { rep: Repertoire; line: Line } | null {
  for (const rep of reps) for (const line of rep.lines) if (lineKey(line) === key) return { rep, line };
  return null;
}

function ReportSheet({ report, account, signingIn, onRetry, onLogin, onAgain, onLobby, onAtlas }: {
  report: Report; account: boolean; signingIn: boolean;
  onRetry(): void; onLogin(): void; onAgain(): void; onLobby(): void; onAtlas(): void;
}) {
  const { plan, summary, score, fails, state, result } = report;
  const scope = plan.scope;
  const isRecord = !!result?.isRecord;
  const record = result?.record ?? null;
  const prev = result?.prev ?? null;
  let sub = '';
  if (plan.mode === 'full' && !plan.eligible) sub = 'Práctica · sin récord';
  else if (state === 'saved' && plan.mode === 'full' && result?.recordable) {
    sub = isRecord ? (prev ? `Nuevo récord · antes ${notaText(prev.nota)}` : 'Primer récord') : record ? `Récord: ${notaText(record.nota)}` : '';
  } else if (state === 'saved' && plan.mode === 'full' && !result?.recordable) sub = 'El repertorio cambió durante la sesión: sin récord';
  return (
    <div class="sheet-backdrop">
      <div class="sheet nt-report" role="dialog" aria-label="Resultado Netero">
        <div class={`sheet-result nt-result ${isRecord ? 'record' : ''}`}>
          <span class="eyebrow">{MODE_NAME[plan.mode]}{scope ? ` · ${scope.kind === 'world' ? 'repertorio completo' : scope.name}` : ''}</span>
          <span class="nt-nota">{notaText(score.nota)}</span>
          {sub && <span class={`result-sub ${isRecord ? 'nt-new' : ''}`}>{sub}</span>}
        </div>
        <dl class="nt-facts">
          <div><dt>Precisión</dt><dd>{pct(score.precision)}</dd></div>
          <div><dt>Ritmo</dt><dd>{fmtSec(score.meanMs)}<small>/jug</small></dd></div>
          <div><dt>Tiempo</dt><dd>{fmtDuration(summary.totalMs)}</dd></div>
          <div><dt>Fails</dt><dd>{summary.fails}</dd></div>
          <div><dt>Líneas</dt><dd>{summary.lines}</dd></div>
        </dl>
        <p class="nt-formula">{summary.firstTry} de {summary.nodes} jugadas a la primera · ritmo {pct(score.ritmo)} → nota {notaText(score.nota)}</p>

        {state === 'saving' && <div class="save-ask"><p class="save-msg"><span class="spinner small" />Guardando…</p></div>}
        {state === 'error' && (
          <div class="save-ask">
            <p class="save-msg bad">{report.message}</p>
            <button type="button" class="btn ghost small" onClick={onRetry}><Icon name="refresh" size={16} />Reintentar</button>
          </div>
        )}
        {state === 'guest' && (
          <div class="save-ask">
            <p class="save-msg">Sin cuenta no se guardan récords.</p>
            <button type="button" class="btn ghost small" onClick={onLogin} disabled={signingIn}><Icon name="login" size={16} />Entrar con Lichess</button>
          </div>
        )}
        {state === 'saved' && <div class="save-ask"><p class="save-msg good"><Icon name="check" size={16} />Sesión guardada.</p></div>}

        {fails.length > 0 && (
          <div class="nt-fails-list">
            <span class="eyebrow">Jugadas falladas</span>
            <ul>
              {fails.map((f) => (
                <li>
                  <MiniBoard fen={f.fen} color={f.color} good={f.expected} bad={f.played} />
                  <div class="nt-fail-text">
                    <span class="nt-fail-move">Correcta: <b>{f.expectedSan}</b></span>
                    <span class="nt-fail-played">Jugaste: {f.playedSan}{f.count > 1 ? ` · ×${f.count}` : ''}</span>
                    <small>{f.title}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div class="sheet-foot">
          <button type="button" class="btn ghost" onClick={onLobby}><Icon name="back" size={18} />Netero</button>
          {account && <button type="button" class="btn ghost" onClick={onAtlas}><Icon name="medal" size={18} />Atlas</button>}
          {summary.failed.length > 0 && <button type="button" class="btn primary" onClick={onAgain}><Icon name="refresh" size={18} />Repetir solo errores</button>}
        </div>
      </div>
    </div>
  );
}

const ROLE: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** A small still board: the position of a failed move, with the right move in green and the one played in red. */
export function MiniBoard({ fen, color, good, bad }: { fen: string; color: 'w' | 'b'; good: string; bad: string }) {
  const pieces: { sq: string; role: string; white: boolean }[] = [];
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      pieces.push({ sq: 'abcdefgh'[f] + (8 - r), role: ROLE[ch.toLowerCase()], white: ch === ch.toUpperCase() });
      f++;
    }
  });
  const pos = (sq: string) => {
    const f = sq.charCodeAt(0) - 97, rk = Number(sq[1]) - 1;
    const x = color === 'w' ? f : 7 - f, y = color === 'w' ? 7 - rk : rk;
    return { transform: `translate(${x * 100}%, ${y * 100}%)` };
  };
  const mark = (sq: string, cls: string) => <i class={`mb-mark ${cls}`} style={pos(sq)} />;
  return (
    <div class="mini-board cg-wrap" aria-hidden="true">
      {mark(good.slice(0, 2), 'good')}{mark(good.slice(2, 4), 'good')}{mark(bad.slice(2, 4), 'bad')}
      {pieces.map((pc) => <piece class={`${pc.role} ${pc.white ? 'white' : 'black'}`} style={pos(pc.sq)} />)}
    </div>
  );
}
