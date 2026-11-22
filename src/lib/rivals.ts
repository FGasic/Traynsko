/**
 * Who Trayner "is" in each game: a grandmaster drawn at random, as on Lichess when you are paired with a
 * stranger, and shown from the start of the game. The latest rivals are kept aside so the same name doesn't
 * come back soon. Shown with the bot's avatar and exported to PGN as "<name> (bot <elo>)": a homage, never the
 * player himself. The names come from scripts/build_rivals.py (every GM, no minors).
 */
import { RIVALS } from './rivalsData';

export { RIVALS };

/** How many recent rivals are kept aside (a quarter of the list: repeats stay rare but possible). */
export const RECENT_MAX = 500;

/** A rival not among the recent ones (any rival, if every name is recent). `rnd` in [0, 1). */
export function randomRival(recent: readonly string[], rnd: () => number = Math.random, names: readonly string[] = RIVALS): string {
  const skip = new Set(recent);
  const free = skip.size ? names.filter((n) => !skip.has(n)) : names;
  const from = free.length ? free : names;
  return from[Math.floor(rnd() * from.length)];
}

/** The recent list after playing `name`: newest first, at most RECENT_MAX. */
export const rememberRival = (recent: readonly string[], name: string) =>
  [name, ...recent.filter((n) => n !== name)].slice(0, RECENT_MAX);
