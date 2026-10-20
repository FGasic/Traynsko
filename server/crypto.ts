import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Master key hash format: scrypt$N$r$p$saltB64$hashB64 */
export function hashSecret(secret: string, N = 1 << 15, r = 8, p = 1): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 32, { N, r, p, maxmem: 256 * N * r });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n), R = Number(r), P = Number(p);
  const expected = Buffer.from(hashB64, 'base64');
  const got = scryptSync(secret, Buffer.from(saltB64, 'base64'), expected.length, { N, r: R, p: P, maxmem: 256 * N * R });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Keys derived from the (secret) master hash: one for signing sessions, one for encrypting world passwords. */
export function deriveKeys(masterHash: string) {
  return {
    sign: createHash('sha256').update('traynsko/session/' + masterHash).digest(),
    enc: createHash('sha256').update('traynsko/world-pw/' + masterHash).digest(),
  };
}

const b64u = (b: Buffer) => b.toString('base64url');

export function signToken(payload: Record<string, unknown>, key: Buffer): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const mac = b64u(createHmac('sha256', key).update(body).digest());
  return `${body}.${mac}`;
}

export function readToken<T>(token: string, key: Buffer): T | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = createHmac('sha256', key).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
}

export function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b64u).join('.');
}

export function decrypt(blob: string, key: Buffer): string | null {
  try {
    const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

/** Case- and accent-insensitive comparison for world passwords typed on phones. */
export function normPassword(s: string) {
  return s.normalize('NFKC').trim().toLowerCase();
}

export function sameText(a: string, b: string) {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export const newId = (n = 9) => randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n + 2) || randomBytes(6).toString('hex');
