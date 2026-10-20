// Vercel Function entry: build.mjs bundles this file into .vercel/output/functions/api.func.
import { createApp } from './core';
import { redisKV, type KV } from './kv';

let kvPromise: Promise<KV> | null = null;
const getKV = () => (kvPromise ??= redisKV().catch((e) => { kvPromise = null; throw e; }));
const app = createApp(getKV, process.env.TRAYNSKO_MASTER_HASH);

export default async function handler(req: any, res: any) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rewritten = url.searchParams.get('__path');
  url.searchParams.delete('__path');
  const path = rewritten !== null ? '/api/' + rewritten : url.pathname;
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ip = String(req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  const out = await app({ method: req.method ?? 'GET', path, query: url.searchParams, auth: req.headers.authorization, body: body ?? {}, ip });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = out.status;
  res.end(JSON.stringify(out.body));
}
