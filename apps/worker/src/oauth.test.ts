import { describe, it, expect, vi, afterEach } from 'vitest';
import { decryptToken, encryptToken } from './crypto.js';
import { connectStart, oauthCallback } from './oauth.js';
import { authUrl } from './instagram.js';
import type { Db } from './db.js';
import type { Env } from './index.js';

const KEY = btoa('A'.repeat(32));
const env: Env = { APP_SECRET: 's', VERIFY_TOKEN: 't', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k', INSTAGRAM_APP_ID: 'app1', INSTAGRAM_APP_SECRET: 'sec1', TOKEN_KEY: KEY, WEB_URL: 'https://web.example.dev' };
afterEach(() => vi.unstubAllGlobals());

function fakeDb(tables: Record<string, unknown[][]>) {
  const writes: { table: string; data: Record<string, unknown> }[] = [];
  const n: Record<string, number> = {};
  const db: Db = {
    select: async <T,>(t: string) => { const i = n[t] ?? 0; n[t] = i + 1; const seq = tables[t] ?? []; return (seq[Math.min(i, seq.length - 1)] ?? []) as T[]; },
    insert: async (table, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
    update: async (table, _q, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
  };
  return { db, writes };
}

describe('token encryption', () => {
  it('round trips and never stores plain text', async () => {
    const blob = await encryptToken('IGQ_secret_token', KEY);
    expect(blob.includes('IGQ_secret_token')).toBe(false);
    expect(await decryptToken(blob, KEY)).toBe('IGQ_secret_token');
  });
  it('fails with a wrong key', async () => {
    const blob = await encryptToken('x', KEY);
    let failed = false;
    try { await decryptToken(blob, btoa('B'.repeat(32))); } catch { failed = true; }
    expect(failed).toBe(true);
  });
});

describe('connect flow', () => {
  it('builds the Instagram Allow url with the needed scopes', () => {
    const u = authUrl('app1', 'https://bot/oauth/callback', 'st1');
    expect(u).toContain('client_id=app1');
    expect(u).toContain('instagram_business_manage_messages');
    expect(u).toContain('state=st1');
  });
  it('refuses a request without login or from another site', async () => {
    const { db } = fakeDb({});
    const r1 = await connectStart(new Request('https://bot/connect/start', { method: 'POST', headers: { origin: 'https://web.example.dev' } }), env, db);
    expect(r1.status).toBe(401);
    const r2 = await connectStart(new Request('https://bot/connect/start', { method: 'POST', headers: { origin: 'https://evil.dev', authorization: 'Bearer x' } }), env, db);
    expect(r2.status).toBe(403);
  });
  it('starts for an admin and stores a one time state', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ email: 'Owner@x.com' }), { status: 200 }));
    const { db, writes } = fakeDb({ admins: [[{ role: 'owner' }]], workspaces: [[{ id: 'w1' }]] });
    const r = await connectStart(new Request('https://bot/connect/start', { method: 'POST', headers: { origin: 'https://web.example.dev', authorization: 'Bearer jwt' } }), env, db);
    expect(r.status).toBe(200);
    expect(writes[0]?.table).toBe('oauth_states');
    expect(String(((await r.json()) as { url: string }).url)).toContain('instagram.com/oauth/authorize');
  });
  it('callback stores only an encrypted token and subscribes webhooks', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      seen.push(String(u));
      if (String(u).includes('oauth/access_token')) return new Response(JSON.stringify({ data: [{ access_token: 'SHORT' }] }), { status: 200 });
      if (String(u).includes('/access_token?')) return new Response(JSON.stringify({ access_token: 'LONGTOKEN', expires_in: 5184000 }), { status: 200 });
      if (String(u).includes('/me?')) return new Response(JSON.stringify({ user_id: '999', username: 'newacc', account_type: 'BUSINESS' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    const { db, writes } = fakeDb({ oauth_states: [[{ workspace_id: 'w1' }]], accounts: [[], [{ id: 'a1', workspace_id: 'w1' }]] });
    const r = await oauthCallback(new Request('https://bot/oauth/callback?code=C&state=S'), env, db);
    expect(r.headers.get('location')).toBe('https://web.example.dev/connect.html?connected=1');
    const tok = writes.find((w) => w.table === 'account_tokens')?.data;
    expect(String(tok?.token_enc).includes('LONGTOKEN')).toBe(false);
    expect(await decryptToken(String(tok?.token_enc), KEY)).toBe('LONGTOKEN');
    expect(seen.some((u) => u.includes('subscribed_apps'))).toBe(true);
  });
  it('rejects an unknown or expired state', async () => {
    const { db } = fakeDb({});
    const r = await oauthCallback(new Request('https://bot/oauth/callback?code=C&state=BAD'), env, db);
    expect(r.headers.get('location')).toContain('connect_error=expired');
  });
});
