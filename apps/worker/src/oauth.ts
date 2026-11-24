import { authUrl, exchangeCode, getAccounts, subscribeWebhooks } from './instagram.js';
import { encryptToken } from './crypto.js';
import type { Db } from './db.js';
import type { Env } from './index.js';

const DAY = 86_400_000;
const clean = (v: string | undefined) => (v ?? '').trim();
const enc = encodeURIComponent;
const iso = (ms: number) => new Date(ms).toISOString();
const webOrigin = (env: Env) => { try { return new URL(clean(env.WEB_URL)).origin; } catch { return ''; } };
const cors = (o: string) => ({ 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' });
const json = (body: unknown, status: number, o: string) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(o) } });
const redirectUri = (r: Request) => `${new URL(r.url).origin}/oauth/callback`;
const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

async function userEmail(env: Env, jwt: string): Promise<string | null> {
  const res = await fetch(`${clean(env.SUPABASE_URL).replace(/\/+$/, '')}/auth/v1/user`, { headers: { apikey: clean(env.SUPABASE_SERVICE_KEY), authorization: `Bearer ${jwt}` } });
  if (!res.ok) return null;
  const u = (await res.json().catch(() => ({}))) as { email?: string };
  return u.email ? u.email.toLowerCase() : null;
}

export async function connectStart(request: Request, env: Env, db: Db): Promise<Response> {
  const o = webOrigin(env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(o) });
  if (request.method !== 'POST' || request.headers.get('origin') !== o) return json({ error: 'not allowed' }, 403, o);
  const jwt = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const email = jwt ? await userEmail(env, jwt) : null;
  if (!email) return json({ error: 'login required' }, 401, o);
  const [adm] = await db.select<{ role: string }>('admins', `email=eq.${enc(email)}&status=eq.active&select=role&limit=1`);
  if (!adm || (adm.role !== 'owner' && adm.role !== 'admin')) return json({ error: 'not allowed' }, 403, o);
  const [ws] = await db.select<{ id: string }>('workspaces', `owner_email=eq.${enc(email)}&select=id&limit=1`);
  if (!ws) return json({ error: 'no workspace' }, 403, o);
  const state = randomHex(24);
  await db.insert('oauth_states', { state, email, workspace_id: ws.id, expires_at: iso(Date.now() + 10 * 60_000) });
  return json({ url: authUrl(clean(env.META_APP_ID), clean(env.UNIFIED_CONFIG_ID), redirectUri(request), state) }, 200, o);
}

export async function oauthCallback(request: Request, env: Env, db: Db, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const web = clean(env.WEB_URL).replace(/\/+$/, '');
  const back = (q: string) => Response.redirect(`${web}/connect.html?${q}`, 302);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code || !state) return back('connect_error=cancelled');
  const [st] = await db.select<{ workspace_id: string }>('oauth_states', `state=eq.${enc(state)}&expires_at=gt.${enc(iso(now))}&select=workspace_id&limit=1`);
  if (!st) return back('connect_error=expired');
  await db.update('oauth_states', `state=eq.${enc(state)}`, { expires_at: '1970-01-01T00:00:00Z' });
  try {
    const tok = await exchangeCode(clean(env.META_APP_ID), clean(env.APP_SECRET), redirectUri(request), code);
    const list = await getAccounts(tok.token);
    if (list.length === 0) return back('connect_error=no_account');
    const blob = await encryptToken(tok.token, clean(env.TOKEN_KEY));
    let ok = 0;
    let hookFail = 0;
    for (const a of list) {
      let [acc] = await db.select<{ id: string; workspace_id: string }>('accounts', `ig_user_id=eq.${enc(a.id)}&select=id,workspace_id&limit=1`);
      if (acc && acc.workspace_id !== st.workspace_id) continue;
      if (acc) await db.update('accounts', `id=eq.${acc.id}`, { handle: a.username });
      else {
        await db.insert('accounts', { workspace_id: st.workspace_id, handle: a.username, ig_user_id: a.id, platform: 'instagram', status: 'active' });
        [acc] = await db.select<{ id: string; workspace_id: string }>('accounts', `ig_user_id=eq.${enc(a.id)}&select=id,workspace_id&limit=1`);
      }
      if (!acc) continue;
      await db.insert('account_tokens', { account_id: acc.id, token_enc: blob, expires_at: iso(now + (tok.expiresIn ?? 60 * 86400) * 1000), refreshed_at: iso(now), scopes: 'unified_login' }, { onConflict: 'account_id' });
      if (!(await subscribeWebhooks(a.id, tok.token))) hookFail++;
      ok++;
    }
    if (ok === 0) return back('connect_error=already_connected');
    return back(hookFail ? 'connected=1&webhook=failed' : 'connected=1');
  } catch (e) {
    console.log('oauth failed', String(e).slice(0, 200));
    return back('connect_error=failed');
  }
}

/** Cron: token type/age is not verified yet (Verify #2), so only warn; no refresh call is guessed. */
export async function refreshDue(db: Db, _env: Env, now: number, log: string[]): Promise<void> {
  const due = await db.select<{ account_id: string }>('account_tokens', `expires_at=lt.${enc(iso(now + 7 * DAY))}&select=account_id&limit=5`);
  for (const t of due) log.push(`token expiring, reconnect ${t.account_id.slice(0, 8)}`);
}
