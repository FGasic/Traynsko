/**
 * Minimal key-value surface used by the server. Two implementations:
 *  - Upstash Redis over REST (production on Vercel; env vars injected by the Upstash integration)
 *  - In-memory (local development and tests)
 * Values are JSON-serialisable objects.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  set(key: string, value: unknown): Promise<void>;
  del(...keys: string[]): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
  zcard(key: string): Promise<number>;
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, member: string): Promise<void>;
  /** increment and set the TTL on first increment; returns the new value */
  hit(key: string, ttlSec: number): Promise<number>;
  /** hash of JSON values (one field per member) */
  hget<T>(key: string, field: string): Promise<T | null>;
  hset(key: string, field: string, value: unknown): Promise<void>;
  hgetall<T>(key: string): Promise<Record<string, T>>;
  hdel(key: string, field: string): Promise<void>;
}

const parse = <T>(v: unknown): T => {
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
};

export function memoryKV(): KV {
  const data = new Map<string, unknown>();
  const zsets = new Map<string, Map<string, number>>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();
  const ttl = new Map<string, number>();
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const alive = (k: string) => { const t = ttl.get(k); if (t && t < Date.now()) { data.delete(k); ttl.delete(k); } };
  return {
    async get<T>(k: string) { alive(k); return data.has(k) ? clone(data.get(k) as T) : null; },
    async mget<T>(keys: string[]) { return keys.map((k) => { alive(k); return data.has(k) ? clone(data.get(k) as T) : null; }); },
    async set(k, v) { data.set(k, clone(v)); },
    async del(...keys) { keys.forEach((k) => { data.delete(k); zsets.delete(k); sets.delete(k); hashes.delete(k); }); },
    async zadd(k, score, m) { if (!zsets.has(k)) zsets.set(k, new Map()); zsets.get(k)!.set(m, score); },
    async zrevrange(k, start, stop) {
      const z = [...(zsets.get(k) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
      return z.slice(start, stop < 0 ? undefined : stop + 1);
    },
    async zrem(k, m) { zsets.get(k)?.delete(m); },
    async zcard(k) { return zsets.get(k)?.size ?? 0; },
    async sadd(k, m) { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k)!.add(m); },
    async smembers(k) { return [...(sets.get(k) ?? [])]; },
    async srem(k, m) { sets.get(k)?.delete(m); },
    async hit(k, ttlSec) {
      alive(k);
      const n = ((data.get(k) as number) ?? 0) + 1;
      data.set(k, n);
      if (n === 1) ttl.set(k, Date.now() + ttlSec * 1000);
      return n;
    },
    async hget<T>(k: string, f: string) { const v = hashes.get(k)?.get(f); return v === undefined ? null : parse<T>(v); },
    async hset(k, f, v) { if (!hashes.has(k)) hashes.set(k, new Map()); hashes.get(k)!.set(f, JSON.stringify(v)); },
    async hgetall<T>(k: string) { const out: Record<string, T> = {}; for (const [f, v] of hashes.get(k) ?? []) out[f] = parse<T>(v); return out; },
    async hdel(k, f) { hashes.get(k)?.delete(f); },
  };
}

export async function redisKV(): Promise<KV> {
  // The Upstash integration may add a custom prefix (e.g. STORAGE_KV_REST_API_URL): accept any of them.
  const env = process.env;
  const find = (suffixes: string[]) => {
    for (const sfx of suffixes) { if (env[sfx]) return env[sfx]; }
    for (const sfx of suffixes) { const k = Object.keys(env).find((n) => n.endsWith('_' + sfx) && env[n]); if (k) return env[k]; }
    return undefined;
  };
  const url = find(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']);
  const token = find(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']);
  if (!url || !token) throw new Error('missing_database');
  const { Redis } = await import('@upstash/redis');
  const r = new Redis({ url, token, automaticDeserialization: true });
  return {
    async get<T>(k: string) { return ((await r.get<T>(k)) ?? null) as T | null; },
    async mget<T>(keys: string[]) { if (!keys.length) return []; return (await r.mget<T[]>(...keys)).map((v) => (v ?? null) as T | null); },
    async set(k, v) { await r.set(k, v); },
    async del(...keys) { if (keys.length) await r.del(...keys); },
    async zadd(k, score, m) { await r.zadd(k, { score, member: m }); },
    async zrevrange(k, start, stop) { return (await r.zrange<string[]>(k, start, stop, { rev: true })).map(String); },
    async zrem(k, m) { await r.zrem(k, m); },
    async zcard(k) { return await r.zcard(k); },
    async sadd(k, m) { await r.sadd(k, m); },
    async smembers(k) { return (await r.smembers(k)).map(String); },
    async srem(k, m) { await r.srem(k, m); },
    async hit(k, ttlSec) {
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, ttlSec);
      return n;
    },
    async hget<T>(k: string, f: string) { const v = await r.hget(k, f); return v === null || v === undefined ? null : parse<T>(v); },
    async hset(k, f, v) { await r.hset(k, { [f]: JSON.stringify(v) }); },
    async hgetall<T>(k: string) {
      const all = (await r.hgetall<Record<string, unknown>>(k)) ?? {};
      const out: Record<string, T> = {};
      for (const [f, v] of Object.entries(all)) out[f] = parse<T>(v);
      return out;
    },
    async hdel(k, f) { await r.hdel(k, f); },
  };
}
