/**
 * Biblioteca › the open repertoire: every line, the player's own sets, and what goes into training.
 * Lines are dragged between sets by their handle (mouse, pen or finger) or moved from their ⋯ menu;
 * the search finds lines by name or by move (Spanish or English letters) and acts on all of them at once.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Repertoire } from '../../shared/types';
import {
  buildIndex, createSet, deleteSet, emptySetsFor, excerpt, foldSet, layoutChapter, lineTitle, lineSub, matchLine, moveLines,
  moveTokens, onlyLines, parseQuery, renameSet, setLinesOn, shiftSet, type LineSet, type LineView, type MoveToken, type Picks,
} from '../lib/picks';
import { prefs } from '../lib/prefs';
import { Check, Dots, Grip, Icon, PieceDot } from './parts';

type CheckState = 'on' | 'off' | 'mixed';
const stateOf = (keys: string[], off: Set<string>): CheckState => {
  const n = keys.filter((k) => !off.has(k)).length;
  return n === 0 ? 'off' : n === keys.length ? 'on' : 'mixed';
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Menu =
  | { kind: 'line'; view: LineView }
  | { kind: 'set'; set: LineSet; rep: string; siblings: string[] }
  | { kind: 'group'; keys: string[]; rep: string };

interface Props {
  worldId: string;
  reps: Repertoire[];
  picks: Picks;
  onChange(next: Picks): void;
  toast(t: string, k?: 'info' | 'good' | 'bad'): void;
}

export function LineManager({ worldId, reps, picks, onChange, toast }: Props) {
  const index = useMemo(() => buildIndex(reps), [reps]);
  const repIds = useMemo(() => reps.map((r) => r.id), [reps]);
  const allViews = useMemo(() => reps.flatMap((r) => index.get(r.id) ?? []), [index, reps]);
  const allKeys = useMemo(() => new Set(allViews.map((v) => v.key)), [allViews]);
  const off = useMemo(() => new Set(picks.off), [picks.off]);
  const [query, setQuery] = useState('');
  const q = useMemo(() => parseQuery(query), [query]);
  const hits = useMemo(() => {
    if (!q) return null;
    const m = new Map<string, Set<number>>();
    for (const v of allViews) { const r = matchLine(v, q); if (r.ok) m.set(v.rep.id + ':' + v.key, r.plies); }
    return m;
  }, [q, allViews]);
  const hitKeys = useMemo(() => (hits ? [...new Set([...hits.keys()].map((k) => k.slice(k.indexOf(':') + 1)))] : []), [hits]);
  const [open, setOpenState] = useState<string[]>(() => prefs.libOpen(worldId) ?? (reps.length === 1 ? [reps[0].id] : []));
  const setOpen = (ids: string[]) => { setOpenState(ids); prefs.saveLibOpen(worldId, ids); };
  const [full, setFull] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const drag = useLineDrag((key, from, target) => {
    const owner = picks.sets.find((s) => s.lines.includes(key))?.id ?? null;
    const to = target.startsWith('set:') ? target.slice(4) : null;
    if (to === owner) return;
    onChange(moveLines(picks, [key], to));
    const name = to ? picks.sets.find((s) => s.id === to)?.name : null;
    toast(name ? `Línea movida a «${name}».` : 'Línea fuera de su conjunto.');
    void from;
  });

  const total = allViews.length;
  const narrow = window.innerWidth < 520;
  const active = allViews.filter((v) => !off.has(v.key)).length;
  const setsShown = picks.sets.length;

  /* ---------- actions ---------- */
  const toggle = (keys: string[], state: CheckState) => onChange(setLinesOn(picks, keys, state !== 'on'));

  function newSet(rep: string, name: string, keys: string[] = []) {
    const n = name.trim();
    if (!n) return;
    const r = createSet(picks, n, rep, keys);
    onChange(r.picks);
    setCreating(null);
    toast(keys.length ? `Conjunto «${n}» creado con ${plural(keys.length, 'línea', 'líneas')}.` : `Conjunto «${n}» creado: arrastra líneas a él.`, 'good');
  }

  return (
    <div class={`lm ${drag.state ? 'is-dragging' : ''}`}>
      <div class="lm-top">
        <p class="summary">
          En juego: <strong>{active}</strong> de {plural(total, 'línea', 'líneas')}
          {setsShown > 0 && <> · {plural(setsShown, 'conjunto', 'conjuntos')}</>}. Cada partida elige al azar una de las líneas en juego.
        </p>
        {active < total && <button type="button" class="btn ghost small" onClick={() => onChange(setLinesOn(picks, [...allKeys], true))}>Activar todas</button>}
      </div>

      <div class="lm-search">
        <Icon name="search" size={18} />
        <input
          id="lm-query" class="input" type="search" value={query} autocomplete="off" spellcheck={false} enterkeyhint="search"
          placeholder={narrow ? 'Nombre o jugada (12.Ae3)' : 'Busca por nombre o jugada: Alapin, 12.Ae3, Cf6…'} aria-label="Buscar líneas por nombre o jugada"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
        />
        {query && <button type="button" class="icon-btn lm-clear" aria-label="Borrar búsqueda" onClick={() => setQuery('')}><Icon name="x" size={18} /></button>}
      </div>

      {q && hits && (
        <div class="lm-results" role="status">
          {hitKeys.length === 0
            ? <span class="lm-res-text">Ninguna línea coincide con «{q.raw}».</span>
            : (
              <>
                <span class="lm-res-text"><strong>{plural(hitKeys.length, 'línea coincide', 'líneas coinciden')}</strong> · {hitKeys.filter((k) => !off.has(k)).length} en juego</span>
                <div class="lm-res-actions">
                  <button type="button" class="btn primary small" onClick={() => { onChange(onlyLines(picks, hitKeys, [...allKeys])); toast(`Ahora entrenas solo ${hitKeys.length === 1 ? 'esta línea' : `estas ${hitKeys.length} líneas`}.`, 'good'); }}>{hitKeys.length === 1 ? 'Entrenar solo esta' : 'Entrenar solo estas'}</button>
                  {hitKeys.some((k) => off.has(k)) && <button type="button" class="btn ghost small" onClick={() => onChange(setLinesOn(picks, hitKeys, true))}>Activar</button>}
                  {hitKeys.some((k) => !off.has(k)) && <button type="button" class="btn ghost small" onClick={() => onChange(setLinesOn(picks, hitKeys, false))}>Desactivar</button>}
                  <button type="button" class="btn ghost small" onClick={() => setMenu({ kind: 'group', keys: hitKeys, rep: allViews.find((v) => hits.has(v.rep.id + ':' + v.key))!.rep.id })}>Agrupar…</button>
                </div>
              </>
            )}
        </div>
      )}

      <ul class="rep-list">
        {reps.map((rep) => {
          const views = index.get(rep.id) ?? [];
          const keys = views.map((v) => v.key);
          const st = stateOf(keys, off);
          const isOpen = !!q || open.includes(rep.id);
          const shown = q ? views.filter((v) => hits!.has(rep.id + ':' + v.key)) : views;
          if (q && shown.length === 0) return null;
          const on = keys.filter((k) => !off.has(k)).length;
          const lay = layoutChapter(views, picks, repIds);
          const empties = emptySetsFor(rep.id, picks, allKeys, repIds);
          const order = new Map(picks.sets.map((s, i) => [s.id, i]));
          const blocks = [...lay.sets, ...empties.map((set) => ({ set, lines: [] as LineView[] }))].sort((a, b) => order.get(a.set.id)! - order.get(b.set.id)!);
          const siblings = blocks.map((b) => b.set.id);
          return (
            <li class={`rep ${st === 'off' ? 'off' : ''}`} key={rep.id}>
              <div class="rep-main">
                <Check id={`rep-${rep.id}`} state={st} label={`Entrenar ${rep.name}`} onToggle={() => toggle(keys, st)} />
                <PieceDot color={rep.color} />
                <button type="button" class="rep-id rep-open" aria-expanded={isOpen} onClick={() => !q && setOpen(isOpen ? open.filter((x) => x !== rep.id) : [...open, rep.id])}>
                  <span class="rep-name">{rep.name}</span>
                  <span class="rep-meta">{rep.color === 'w' ? 'Blancas' : 'Negras'} · {on === keys.length ? plural(keys.length, 'línea', 'líneas') : `${on} de ${keys.length} líneas en juego`}{blocks.length > 0 && ` · ${plural(blocks.length, 'conjunto', 'conjuntos')}`}</span>
                </button>
                {!q && (
                  <button type="button" class="icon-btn" aria-label={isOpen ? `Plegar ${rep.name}` : `Ver las líneas de ${rep.name}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? open.filter((x) => x !== rep.id) : [...open, rep.id])}>
                    <span class={`chev ${isOpen ? 'open' : ''}`}><Icon name="chevron" size={18} /></span>
                  </button>
                )}
              </div>

              {isOpen && (
                <div class="lm-body">
                  {blocks.map(({ set, lines }) => {
                    const vis = q ? lines.filter((v) => hits!.has(rep.id + ':' + v.key)) : lines;
                    if (q && vis.length === 0) return null;
                    const sk = lines.map((v) => v.key);
                    const sst = lines.length ? stateOf(sk, off) : 'off';
                    const closed = !q && !!set.closed;
                    const onIn = sk.filter((k) => !off.has(k)).length;
                    return (
                      <section class={`lm-set ${closed ? 'closed' : ''} ${drag.state?.over === 'set:' + set.id ? 'drop' : ''}`} data-drop={`set:${set.id}`} data-rep={rep.id} key={set.id} aria-label={`Conjunto ${set.name}`}>
                        <header class="lm-set-head">
                          {lines.length > 0
                            ? <Check state={sst} label={`Entrenar el conjunto ${set.name}`} onToggle={() => toggle(sk, sst)} />
                            : <span class="check-spacer" />}
                          <button type="button" class="lm-set-title" aria-expanded={!closed} onClick={() => !q && onChange(foldSet(picks, set.id, !set.closed))}>
                            <span class={`chev ${closed ? '' : 'open'}`}><Icon name="chevron" size={16} /></span>
                            <span class="lm-set-name">{set.name}</span>
                            <span class="lm-count" title={`${onIn} de ${lines.length} en juego`}>{lines.length === onIn ? lines.length : `${onIn}/${lines.length}`}</span>
                          </button>
                          <button type="button" class="icon-btn lm-more" aria-label={`Opciones del conjunto ${set.name}`} onClick={() => setMenu({ kind: 'set', set, rep: rep.id, siblings })}><Dots /></button>
                        </header>
                        {!closed && (vis.length
                          ? <ol class="lm-lines">{vis.map((v) => <LineRow v={v} on={!off.has(v.key)} hits={hits?.get(rep.id + ':' + v.key)} full={full === rep.id + ':' + v.key} onFull={() => setFull(full === rep.id + ':' + v.key ? null : rep.id + ':' + v.key)} onToggle={() => onChange(setLinesOn(picks, [v.key], off.has(v.key)))} onMenu={() => setMenu({ kind: 'line', view: v })} onGrab={(e) => drag.start(e, v)} dragging={drag.state?.key === v.key && drag.state.rep === rep.id} />)}</ol>
                          : <p class="lm-empty">Arrastra líneas aquí, o usa <Dots size={14} /> › Mover en cada línea.</p>)}
                      </section>
                    );
                  })}

                  {(() => {
                    const vis = q ? lay.loose.filter((v) => hits!.has(rep.id + ':' + v.key)) : lay.loose;
                    if (q && vis.length === 0) return null;
                    if (!vis.length && !blocks.length) return null;
                    return (
                      <section class={`lm-set loose ${blocks.length ? '' : 'bare'} ${drag.state?.over === 'loose:' + rep.id ? 'drop' : ''}`} data-drop={`loose:${rep.id}`} data-rep={rep.id} aria-label="Líneas sin conjunto">
                        {blocks.length > 0 && <header class="lm-loose-head"><span>Sin conjunto</span><span class="lm-count">{lay.loose.length}</span></header>}
                        {vis.length
                          ? <ol class="lm-lines">{vis.map((v) => <LineRow v={v} on={!off.has(v.key)} hits={hits?.get(rep.id + ':' + v.key)} full={full === rep.id + ':' + v.key} onFull={() => setFull(full === rep.id + ':' + v.key ? null : rep.id + ':' + v.key)} onToggle={() => onChange(setLinesOn(picks, [v.key], off.has(v.key)))} onMenu={() => setMenu({ kind: 'line', view: v })} onGrab={(e) => drag.start(e, v)} dragging={drag.state?.key === v.key && drag.state.rep === rep.id} />)}</ol>
                          : <p class="lm-empty">Todas las líneas están en algún conjunto. Arrastra una aquí para sacarla.</p>}
                      </section>
                    );
                  })()}

                  {!q && (creating === rep.id
                    ? <NameForm label="Nombre del conjunto" placeholder="Por ejemplo: Alapin" submit="Crear" onSubmit={(n) => newSet(rep.id, n)} onCancel={() => setCreating(null)} />
                    : <button type="button" class="btn ghost small lm-new" onClick={() => setCreating(rep.id)}><Icon name="plus" size={16} />Nuevo conjunto</button>)}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {drag.state && <div class="lm-ghost" ref={drag.ghost} aria-hidden="true"><Grip size={16} />{drag.state.title}</div>}

      {menu?.kind === 'line' && (
        <MoveSheet
          title={lineTitle(menu.view.line, menu.view.index)}
          eyebrow="Mover línea"
          current={picks.sets.find((s) => s.lines.includes(menu.view.key))?.id ?? null}
          sets={setsFor(menu.view.rep.id)}
          onPick={(id) => { onChange(moveLines(picks, [menu.view.key], id)); setMenu(null); toast(id ? `Línea movida a «${picks.sets.find((s) => s.id === id)!.name}».` : 'Línea fuera de su conjunto.'); }}
          onCreate={(n) => { newSet(menu.view.rep.id, n, [menu.view.key]); setMenu(null); }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'group' && (
        <MoveSheet
          title={plural(menu.keys.length, 'línea encontrada', 'líneas encontradas')}
          eyebrow={`Agrupar «${q?.raw ?? ''}»`}
          current={undefined}
          sets={setsFor(null)}
          suggestion={q?.raw ?? ''}
          onPick={(id) => { onChange(moveLines(picks, menu.keys, id)); setMenu(null); toast(id ? `${plural(menu.keys.length, 'línea movida', 'líneas movidas')} a «${picks.sets.find((s) => s.id === id)!.name}».` : 'Líneas fuera de sus conjuntos.'); }}
          onCreate={(n) => { newSet(menu.rep, n, menu.keys); setMenu(null); }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'set' && (
        <SetSheet
          set={menu.set}
          canUp={menu.siblings.indexOf(menu.set.id) > 0}
          canDown={menu.siblings.indexOf(menu.set.id) < menu.siblings.length - 1}
          onRename={(n) => { onChange(renameSet(picks, menu.set.id, n)); setMenu(null); }}
          onShift={(d) => { onChange(shiftSet(picks, menu.set.id, d, menu.siblings)); setMenu(null); }}
          onDelete={() => { onChange(deleteSet(picks, menu.set.id)); setMenu(null); toast(`Conjunto «${menu.set.name}» eliminado. Sus líneas siguen en el repertorio.`); }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );

  /** The sets a line of `rep` can go to: those shown in that chapter (or every set, for a search across chapters). */
  function setsFor(rep: string | null): LineSet[] {
    if (!rep) return picks.sets;
    const views = index.get(rep) ?? [];
    const keys = new Set(views.map((v) => v.key));
    const empties = new Set(emptySetsFor(rep, picks, allKeys, repIds).map((s) => s.id));
    return picks.sets.filter((s) => empties.has(s.id) || s.lines.some((k) => keys.has(k)));
  }
}

/* ---------------- one line ---------------- */

function Moves({ tokens }: { tokens: MoveToken[] }) {
  return <>{tokens.map((t, i) => <>{i > 0 && ' '}{t.num && <span class="mn">{t.num}</span>}{t.hit ? <mark>{t.text}</mark> : t.text}</>)}</>;
}

function LineRow({ v, on, hits, full, onFull, onToggle, onMenu, onGrab, dragging }: {
  v: LineView; on: boolean; hits?: Set<number>; full: boolean; dragging: boolean;
  onFull(): void; onToggle(): void; onMenu(): void; onGrab(e: PointerEvent): void;
}) {
  const title = lineTitle(v.line, v.index);
  const sub = lineSub(v.line);
  const ex = excerpt(v, hits);
  const moves = Math.ceil(v.sans.length / 2);
  return (
    <li class={`lm-line ${on ? '' : 'off'} ${dragging ? 'lifted' : ''}`}>
      <span class="lm-grip" title="Arrastrar a otro conjunto" onPointerDown={(e) => onGrab(e as unknown as PointerEvent)}><Grip /></span>
      <Check state={on ? 'on' : 'off'} label={`Entrenar ${title}`} onToggle={onToggle} />
      <button type="button" class="lm-text" aria-expanded={full} onClick={onFull} title={full ? 'Ocultar las jugadas' : 'Ver todas las jugadas'}>
        <span class="lm-title"><span class="lm-name">{title}</span>{sub && <span class="lm-sub">{sub}</span>}</span>
        {!full && <span class="lm-moves">{ex.head && '… '}<Moves tokens={ex.tokens} />{ex.tail && ' …'}</span>}
      </button>
      <span class="lm-len">{moves} jug.</span>
      <button type="button" class="icon-btn lm-more" aria-label={`Mover ${title}`} onClick={onMenu}><Dots /></button>
      {full && <p class="lm-full"><Moves tokens={moveTokens(v, 0, v.sans.length, hits)} /></p>}
    </li>
  );
}

/* ---------------- sheets ---------------- */

function NameForm({ label, placeholder, submit, initial = '', onSubmit, onCancel }: {
  label: string; placeholder: string; submit: string; initial?: string; onSubmit(n: string): void; onCancel?(): void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form class="lm-form" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v); }}>
      <input ref={ref} class="input small" value={v} maxLength={60} placeholder={placeholder} aria-label={label} onInput={(e) => setV((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } }} />
      <button type="submit" class="btn primary small" disabled={!v.trim()}>{submit}</button>
      {onCancel && <button type="button" class="btn ghost small" onClick={onCancel}>Cancelar</button>}
    </form>
  );
}

function Sheet({ label, onClose, children }: { label: string; onClose(): void; children: any }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet lm-sheet" role="dialog" aria-label={label}>{children}</div>
    </div>
  );
}

function MoveSheet({ eyebrow, title, current, sets, suggestion = '', onPick, onCreate, onClose }: {
  eyebrow: string; title: string; current: string | null | undefined; sets: LineSet[]; suggestion?: string;
  onPick(id: string | null): void; onCreate(name: string): void; onClose(): void;
}) {
  return (
    <Sheet label={eyebrow} onClose={onClose}>
      <div class="gate-body">
        <span class="eyebrow">{eyebrow}</span>
        <h2 class="lm-sheet-title">{title}</h2>
      </div>
      <div class="lm-targets" role="list">
        {sets.map((s) => (
          <button type="button" role="listitem" class={`lm-target ${current === s.id ? 'current' : ''}`} disabled={current === s.id} onClick={() => onPick(s.id)}>
            <span>{s.name}</span><span class="lm-count">{current === s.id ? 'Aquí está' : s.lines.length}</span>
          </button>
        ))}
        {current !== undefined
          ? current !== null && <button type="button" role="listitem" class="lm-target loose" onClick={() => onPick(null)}><span>Sacar del conjunto</span></button>
          : sets.length > 0 && <button type="button" role="listitem" class="lm-target loose" onClick={() => onPick(null)}><span>Sacar de sus conjuntos</span></button>}
      </div>
      <div class="lm-sheet-new">
        <span class="field-label">Nuevo conjunto</span>
        <NameForm label="Nombre del nuevo conjunto" placeholder="Por ejemplo: Alapin" submit="Crear" initial={/^\d|[.…]/.test(suggestion) ? '' : suggestion.replace(/^./, (c) => c.toUpperCase())} onSubmit={onCreate} />
      </div>
      <div class="sheet-foot"><span /><button type="button" class="btn ghost" onClick={onClose}>Cerrar</button></div>
    </Sheet>
  );
}

function SetSheet({ set, canUp, canDown, onRename, onShift, onDelete, onClose }: {
  set: LineSet; canUp: boolean; canDown: boolean; onRename(n: string): void; onShift(d: -1 | 1): void; onDelete(): void; onClose(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet label={`Conjunto ${set.name}`} onClose={onClose}>
      <div class="gate-body">
        <span class="eyebrow">Conjunto</span>
        <h2 class="lm-sheet-title">{set.name}</h2>
        <span class="field-label">Nombre</span>
        <NameForm label="Nuevo nombre del conjunto" placeholder="Nombre" submit="Guardar" initial={set.name} onSubmit={onRename} />
        <div class="row-actions">
          <button type="button" class="btn ghost small" disabled={!canUp} onClick={() => onShift(-1)}>Subir</button>
          <button type="button" class="btn ghost small" disabled={!canDown} onClick={() => onShift(1)}>Bajar</button>
        </div>
        {confirm
          ? (
            <div class="confirm">
              <span>Sus líneas no se borran: vuelven a «Sin conjunto».</span>
              <button type="button" class="btn danger small" onClick={onDelete}>Eliminar</button>
              <button type="button" class="btn ghost small" onClick={() => setConfirm(false)}>No</button>
            </div>
          )
          : <button type="button" class="btn ghost small danger-text lm-del" onClick={() => setConfirm(true)}><Icon name="trash" size={16} />Eliminar conjunto</button>}
      </div>
      <div class="sheet-foot"><span /><button type="button" class="btn ghost" onClick={onClose}>Cerrar</button></div>
    </Sheet>
  );
}

/* ---------------- dragging a line by its handle ---------------- */

interface DragState { key: string; rep: string; title: string; over: string | null }

function useLineDrag(onDrop: (key: string, rep: string, target: string) => void) {
  const [state, setState] = useState<DragState | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const live = useRef<{ x: number; y: number; dx: number; dy: number; over: string | null; data: DragState | null; scroller: HTMLElement | null; raf: number; stop: () => void } | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const place = () => {
    const l = live.current, g = ghost.current;
    if (l && g) g.style.transform = `translate3d(${l.x - l.dx}px, ${l.y - l.dy}px, 0)`;
  };
  useLayoutEffect(place, [state?.key, state?.rep]);
  useEffect(() => () => live.current?.stop(), []);

  function hitTest() {
    const l = live.current;
    if (!l?.data) return;
    const el = (document.elementFromPoint(l.x, l.y) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]');
    const over = el && el.dataset.rep === l.data.rep ? el.dataset.drop! : null;
    if (over !== l.over) { l.over = over; setState({ ...l.data, over }); }
  }

  function start(e: PointerEvent, v: LineView) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    live.current?.stop();
    const handle = e.currentTarget as HTMLElement;
    try { handle.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    const row = handle.closest('li')!.getBoundingClientRect();
    const data: DragState = { key: v.key, rep: v.rep.id, title: lineTitle(v.line, v.index), over: null };
    const scroller = handle.closest<HTMLElement>('.screen.page') ?? (document.scrollingElement as HTMLElement | null);
    const move = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; ev.preventDefault(); l.x = ev.clientX; l.y = ev.clientY; place(); hitTest(); };
    const up = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; const over = l.over; stop(); if (over && ev.type === 'pointerup') dropRef.current(data.key, data.rep, over); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') stop(); };
    const tick = () => {
      // near the top or bottom edge, the page scrolls by itself
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
        const zone = 72;
        let dy = 0;
        if (l.y < top + zone) dy = -Math.ceil(((top + zone - l.y) / zone) * 16);
        else if (l.y > bottom - zone) dy = Math.ceil(((l.y - (bottom - zone)) / zone) * 16);
        if (dy) { scroller.scrollTop += dy; hitTest(); }
      }
      l.raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(l.raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
      document.documentElement.classList.remove('lm-dragging');
      live.current = null;
      setState(null);
    };
    const l = { x: e.clientX, y: e.clientY, dx: Math.min(e.clientX - row.left, 40), dy: e.clientY - row.top, over: null as string | null, data, scroller, raf: 0, stop };
    live.current = l;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key);
    document.documentElement.classList.add('lm-dragging');
    l.raf = requestAnimationFrame(tick);
    setState(data);
  }

  return { state, start, ghost };
}
