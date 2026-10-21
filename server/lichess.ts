// "Entrar con Lichess": the browser runs OAuth2 + PKCE and hands the code to the server,
// which exchanges it, reads who the player is and revokes the token straight away.
// Traynsko never keeps a Lichess token and asks for no scopes (no email, no games, nothing to act with).
import { LICHESS_CLIENT_ID } from '../shared/atlas';

export interface LichessIdentity { id: string; username: string }
export interface LichessClient {
  identify(code: string, verifier: string, redirectUri: string): Promise<LichessIdentity>;
}

export class LichessError extends Error {}

export function lichessClient(base = 'https://lichess.org', fetchImpl: typeof fetch = fetch): LichessClient {
  return {
    async identify(code, verifier, redirectUri) {
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: LICHESS_CLIENT_ID,
      });
      const tr = await fetchImpl(`${base}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form.toString(),
      });
      const tok = (await tr.json().catch(() => null)) as { access_token?: string } | null;
      if (!tr.ok || !tok?.access_token) throw new LichessError(`token ${tr.status}`);
      const auth = { Authorization: `Bearer ${tok.access_token}` };
      try {
        const ar = await fetchImpl(`${base}/api/account`, { headers: { ...auth, Accept: 'application/json' } });
        const acc = (await ar.json().catch(() => null)) as { id?: string; username?: string } | null;
        if (!ar.ok || !acc?.id || !acc.username) throw new LichessError(`account ${ar.status}`);
        return { id: String(acc.id).toLowerCase(), username: String(acc.username) };
      } finally {
        // the token was only needed to learn the username: revoke it (best effort)
        await fetchImpl(`${base}/api/token`, { method: 'DELETE', headers: auth }).catch(() => {});
      }
    },
  };
}
