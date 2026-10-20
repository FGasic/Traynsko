// Local development server: static files from dist/ + the same API as Vercel, backed by memory.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createApp } from '../server/core';
import { memoryKV } from '../server/kv';
import { hashSecret } from '../server/crypto';

const port = Number(process.env.PORT ?? 8790);
const master = process.env.TRAYNSKO_MASTER_HASH ?? hashSecret(process.env.DEV_MASTER ?? 'maestro-dev', 1 << 12);
const kv = memoryKV();
const app = createApp(async () => kv, master);
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const out = await app({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, auth: req.headers.authorization, body, ip: String(req.headers['x-test-ip'] ?? '127.0.0.1') });
    res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out.body));
    return;
  }
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const data = await readFile(join('dist', rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = await readFile(join('dist', 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    res.end(data);
  }
}).listen(port, () => console.log(`Traynsko dev en http://localhost:${port}`));
