import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveConfig, runLive } from './live.js';
import { encryptToken } from './crypto.js';
import type { Db } from './db.js';
import type { Env } from './index.js';

const KEY = btoa('A'.repeat(32));
const NOW = Date.parse('2026-11-24T14:00:00.000Z');
const env: Env = { APP_SECRET: 's', VERIFY_TOKEN: 't', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_KEY: 'k', TOKEN_KEY: KEY, LIVE_ENABLED: 'true' };
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const tok = await encryptToken('TOK', KEY);
  const writes: { table: string; data: Record<string, unknown> }[] = [];
  const db: Db = {
    select: async <T,>(t: string, q: string) => {
      if (t === 'accounts') return [{ id: 'a1', workspace_id: 'w1', ig_user_id: '99', live_since: '2026-11-20T00:00:00.000Z' }] as T[];
      if (t === 'dm_jobs' && q.includes('status=eq.queued')) return [{ id: 'j1', comment_id: 'c1', campaign_id: 'k1', from_id: 'u1', username: 'u1', reel_id: 'r1', comment_at: '2026-11-24T13:50:00.000Z' }] as T[];
      if (t === 'account_tokens') return [{ token_enc: tok }] as T[];
      if (t === 'campaigns') return [{ id: 'k1', link_url: 'https://example.com/x', variants: ['Hey {name} {link}'], template: 'Hi {link}' }] as T[];
      return [] as T[];
    },
    insert: async (table, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
    update: async (table, _q, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
  };
  return { db, writes };
}

describe('live sending', () => {
  it('does nothing unless the LIVE_ENABLED switch is on', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { db, writes } = await setup();
    expect(await runLive(db, { ...env, LIVE_ENABLED: undefined }, NOW, [])).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
  it('sends one private reply with the saved link and records it', async () => {
    let body = '';
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { body = String(init.body); return new Response('{}', { status: 200 }); });
    const { db, writes } = await setup();
    await runLive(db, env, NOW, []);
    expect(body).toContain('"comment_id":"c1"');
    expect(body).toContain('https://example.com/x');
    expect(writes.some((w) => w.table === 'dm_jobs' && w.data.status === 'sent')).toBe(true);
  });
  it('a rate limit stops live and puts the account back to dry run', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 4 } }), { status: 400 }));
    const { db, writes } = await setup();
    await runLive(db, env, NOW, []);
    expect(writes.some((w) => w.table === 'accounts' && w.data.mode === 'dry_run')).toBe(true);
  });
  it('warm-up is strict in week 1 and the user cannot speed it up', () => {
    const c = liveConfig({ id: 'a', workspace_id: 'w', ig_user_id: '1', live_since: new Date(NOW - 86_400_000).toISOString(), daily_cap: 20 }, NOW);
    expect(c.gapSec).toBe(40);
    expect(c.dailyCap).toBe(20);
  });
});
