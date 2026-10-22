// Pure checks of the line selection: search by move or name, sets, training pool, validation.
import { readFileSync } from 'node:fs';
import { parseRepertoire } from '../src/lib/pgn';
import {
  buildIndex, parseQuery, matchLine, moveCandidates, sanMatches, layoutChapter, emptySetsFor, setLinesOn, onlyLines,
  moveLines, createSet, renameSet, deleteSet, foldSet, shiftSet, fromDisabledChapters, excerpt, emptyPicks, cleanPicks, lineKey, offSet,
} from '../src/lib/picks';
import type { Repertoire } from '../shared/types';

let ok = 0, bad = 0;
const check = (cond: boolean, msg: string) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };

const lines = parseRepertoire(readFileSync('tests/fixtures/siciliana-negras.pgn', 'utf8')).lines;
const rep: Repertoire = { id: 'RepSic01', name: 'Siciliana', color: 'b', lineCount: lines.length, lines };
const rep2Lines = parseRepertoire(readFileSync('tests/fixtures/benko-negras.pgn', 'utf8')).lines;
const rep2: Repertoire = { id: 'RepBen02', name: 'Benko', color: 'b', lineCount: rep2Lines.length, lines: rep2Lines };
const reps = [rep, rep2];
const idx = buildIndex(reps);
const views = idx.get(rep.id)!;
check(views.length === 7, 'seven Sicilian lines');
check(views[0].sans[0] === 'e4' && views[0].sans[5] === 'cxd4', 'moves replayed in SAN');

const find = (q: string) => views.filter((v) => matchLine(v, parseQuery(q)!).ok).map((v) => v.line.white);
// moves, Spanish or English, with and without move number
check(find('12.Ae3').join() === 'Najdorf 6.Ae2', '12.Ae3 (Spanish) finds only the line with 12.Be3');
check(find('12.Be3').join() === 'Najdorf 6.Ae2', '12.Be3 (English) as well');
check(find('12. Be3').join() === 'Najdorf 6.Ae2', '"12. Be3" with a space');
check(find('Ae3').length === 2, 'Ae3 at any move number: 6.Be3 and 9.Be3/12.Be3 lines');
check(find('2.c3').length === 2 && find('2.c3').every((n) => n.startsWith('Alapin')), '2.c3 = both Alapin lines');
check(find('alapin').length === 2, 'by name, any case');
check(find('Moscu').join() === 'Moscú 3.Ab5+', 'by name, without accent');
check(find('3.Ab5+').join() === 'Moscú 3.Ab5+', 'check sign typed');
check(find('Cf6').length === 6, 'Cf6 (Spanish knight) in six lines');
check(find('2...Cf6').join() === 'Alapin 2...Cf6', 'black move with number: 2...Cf6');
check(find('2…Cf6').join() === 'Alapin 2...Cf6', 'with the ellipsis character');
check(find('Cd7').length === 3, 'Cd7 finds Nbd7 (notation adds the file)');
check(find('0-0-0').length === 2, 'castling typed with zeros');
check(find('najdorf 6.Ae3').join() === 'Najdorf 6.Ae3', 'name and move together (both must match)');
check(find('Rxf1').length === 0 && moveCandidates('Rxf1')!.includes('Kxf1'), 'R is rey or rook');
check(find('cxd4').length === 6, 'pawn capture');
check(find('xyz').length === 0, 'nothing for nonsense');
check(moveCandidates('e8')!.includes('e8=Q') && moveCandidates('e8D')!.join() === 'e8=Q', 'promotions');
check(sanMatches('Nd4', 'Nxd4') && !sanMatches('Nxd4', 'Nd4') && sanMatches('Nbd7', 'Nbd7') && !sanMatches('Nfd7', 'Nbd7'), 'lenient piece matching');
check(!sanMatches('d5', 'exd5'), 'a pawn push is not a capture');
const hit = matchLine(views[2], parseQuery('12.Ae3')!);
const ex = excerpt(views[2], hit.plies);
check(ex.tokens.some((t) => t.hit && t.text === 'Be3' && t.num === '12.'), `excerpt shows the hit: ${JSON.stringify(ex.tokens)}`);
const exA = excerpt(views[3]);
check(exA.tokens[0].num === '2.' || exA.tokens[0].num === '1…', `divergence excerpt for Alapin starts near move 2: ${JSON.stringify(exA.tokens.slice(0, 2))}`);

// sets
let p = emptyPicks();
const alapin = views.filter((v) => v.line.white.startsWith('Alapin')).map((v) => v.key);
const made = createSet(p, '  Alapin  ', rep.id, alapin);
p = made.picks;
check(p.sets.length === 1 && p.sets[0].name === 'Alapin' && p.sets[0].lines.length === 2, 'create set with lines');
let lay = layoutChapter(views, p, reps.map((r) => r.id));
check(lay.sets.length === 1 && lay.sets[0].lines.length === 2 && lay.loose.length === 5, 'chapter layout: set + loose');
const naj = createSet(p, 'Najdorf', rep.id);
p = naj.picks;
const allKeys = new Set(reps.flatMap((r) => r.lines.map(lineKey)));
check(emptySetsFor(rep.id, p, allKeys, reps.map((r) => r.id)).map((s) => s.name).join() === 'Najdorf', 'empty set shows in its chapter');
check(emptySetsFor(rep2.id, p, allKeys, reps.map((r) => r.id)).length === 0, 'and not in another one');
p = moveLines(p, [views[0].key, views[1].key, views[2].key], naj.id);
lay = layoutChapter(views, p, reps.map((r) => r.id));
check(lay.sets.map((s) => s.set.name).join() === 'Alapin,Najdorf' && lay.loose.length === 2, 'drag three lines into Najdorf');
p = moveLines(p, [views[3].key], naj.id);
check(p.sets[0].lines.length === 1 && p.sets[1].lines.length === 4, 'a line is in one set at most');
p = moveLines(p, [views[3].key], null);
check(!p.sets.some((s) => s.lines.includes(views[3].key)), 'back to no set');
p = renameSet(p, naj.id, 'Najdorf (6.Ag5 y 6.Ae3)');
check(p.sets[1].name.startsWith('Najdorf ('), 'rename');
p = shiftSet(p, naj.id, -1, [made.id, naj.id]);
check(p.sets[0].id === naj.id, 'move set up');
p = foldSet(p, naj.id, true);
check(p.sets[0].closed === true, 'fold');
p = foldSet(p, naj.id, false);
check(!('closed' in p.sets[0]), 'unfold');

// training selection
p = setLinesOn(p, alapin, false);
let off = offSet(p);
check(rep.lines.filter((l) => !off.has(lineKey(l))).length === 5, 'Alapin out of training');
const target = views.filter((v) => matchLine(v, parseQuery('12.Ae3')!).ok).map((v) => v.key);
p = onlyLines(p, target, [...allKeys]);
off = offSet(p);
check(reps.flatMap((r) => r.lines).filter((l) => !off.has(lineKey(l))).length === 1, 'only the 12.Ae3 line is trained, in the whole repertoire');
p = setLinesOn(p, [...allKeys], true);
check(p.off.length === 0, 'everything back in');
p = deleteSet(p, made.id);
check(p.sets.length === 1, 'delete a set (its lines stay)');
check(cleanPicks(JSON.parse(JSON.stringify(p)))?.sets.length === 1, 'valid round trip');
check(cleanPicks({ ...p, sets: [{ id: 'x', name: 'a', lines: [] }] }) === null, 'bad set id refused');
check(cleanPicks({ ...p, v: 2 }) === null, 'unknown version refused');
check(cleanPicks({ ...p, off: ['ok12345678a', 42, 'BAD!'] })!.off.join() === 'ok12345678a', 'junk keys dropped');
const dup = cleanPicks({ ...p, sets: [{ id: 'aaaa1', name: 'A', lines: [views[0].key] }, { id: 'bbbb2', name: 'B', lines: [views[0].key] }] })!;
check(dup.sets[1].lines.length === 0, 'a line in two sets keeps the first');
const mig = fromDisabledChapters(reps, [rep2.id]);
check(!!mig && mig.off.length === rep2.lines.length, 'old switched-off chapters become switched-off lines');
check(lineKey({ uci: 'e2e4 c7c5' }) === lineKey({ uci: ' e2e4  c7c5 ', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }), 'key ignores spacing and the standard start');

const t0 = Date.now();
const big: Repertoire = { ...rep, id: 'BigRep001', lines: Array.from({ length: 400 }, (_, i) => ({ ...lines[i % lines.length], id: 'l' + i, uci: lines[i % lines.length].uci })) };
buildIndex([big]);
check(Date.now() - t0 < 1500, `400 lines indexed fast (${Date.now() - t0} ms)`);

console.log(`picks: ${ok} ok, ${bad} failed`);
if (bad) process.exit(1);
