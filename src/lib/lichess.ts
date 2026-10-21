// "Entrar con Lichess" in the browser: OAuth2 Authorization Code + PKCE (no app registration needed).
// The verifier stays on this device until the server exchanges the code; Traynsko asks for no scopes.
import { LICHESS_CLIENT_ID } from '../../shared/atlas';

const AUTHORIZE = 'https://lichess.org/oauth';
const KEY = 'traynsko:oauth';
const MAX_AGE = 15 * 60_000;

interface Pending { state: string; verifier: string; redirectUri: string; returnWorld?: string; at: number }

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Where Lichess sends the player back: the app's own root page. */
export const redirectUri = () => location.origin + '/';

/** Leaves the page for lichess.org. `returnWorld` reopens that repertoire's door afterwards. */
export async function startLichessLogin(returnWorld?: string): Promise<void> {
  if (!crypto?.subtle) throw new Error('Este navegador no permite iniciar sesión de forma segura.');
  const verifier = random(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const p: Pending = { state: random(16), verifier, redirectUri: redirectUri(), returnWorld, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { throw new Error('Activa el almacenamiento del navegador para iniciar sesión.'); }
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: LICHESS_CLIENT_ID,
    redirect_uri: p.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: p.state,
  });
  location.assign(`${AUTHORIZE}?${q}`);
}

export type LichessReturn =
  | { kind: 'code'; code: string; verifier: string; redirectUri: string; returnWorld?: string }
  | { kind: 'cancelled'; returnWorld?: string }
  | { kind: 'invalid' };

/** Reads (and removes from the address bar) the answer Lichess appended to the URL, if any. */
export function takeLichessReturn(): LichessReturn | null {
  const q = new URLSearchParams(location.search);
  if (!q.has('state') || (!q.has('code') && !q.has('error'))) return null;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ }
  let p: Pending | null = null;
  try { p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); localStorage.removeItem(KEY); } catch { p = null; }
  if (!p || p.state !== q.get('state') || Date.now() - p.at > MAX_AGE) return { kind: 'invalid' };
  if (q.get('error')) return { kind: 'cancelled', returnWorld: p.returnWorld };
  return { kind: 'code', code: q.get('code')!, verifier: p.verifier, redirectUri: p.redirectUri, returnWorld: p.returnWorld };
}

export const lichessProfile = (name: string) => `https://lichess.org/@/${encodeURIComponent(name)}`;
