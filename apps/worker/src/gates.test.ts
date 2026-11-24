import { describe, it, expect, vi, afterEach } from 'vitest';
import { ingestMessages, pollGates } from './gates.js';
import { encryptToken } from './crypto.js';
import type { Db } from './db.js';
import type { Env } from './index.js';

const NOW = Date.parse('2026-11-24T14:00:00.000Z');
const KEY = btoa('A'.repeat(32));
const env: Env = { APP_SECRET: 's', VERIFY_TOKEN: 't', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_KEY: 'k', TOKEN_KEY: KEY, LIVE_ENABLED: 'true' };
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const tok = await encryptToken('TOK', KEY);
  const writes: { table: string; data: Record<string, unknown> }[] = [];
  const db: Db = {
    select: async <T,>(t: string) => {
      if (t === 'accounts') return [{ id: 'a1', workspace_id: 'w1', status: 'active', mode: 'live', ig_user_id: '99' }] as T[];
      if (t === 'dm_gates') return [{ id: 'g1', account_id: 'a1', comment_id: 'c1', campaign_id: 'k1', username: 'u1', reel_id: 'r1', igsid: 'u1', created_at: '2026-11-24T07:00:00.000Z' }] as T[];
      if (t === 'account_tokens') return [{ token_enc: tok }] as T[];
      return [] as T[];
    },
    insert: async (table, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
    update: async (table, _q, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
  };
  return { db, writes };
}

describe('button flow replies', () => {
  it('a tap or reply queues the link job with a 24h deadline', async () => {
    const { db, writes } = await setup();
    await ingestMessages(db, [{ ig_user_id: '99', sender_id: 'u1', mid: 'm1', text: 'Send me the link' }], NOW);
    const job = writes.find((w) => w.table === 'dm_jobs')?.data;
    expect(job?.stage).toBe('link');
    expect(job?.comment_id).toBe('c1:link');
    expect(Date.parse(String(job?.deadline_at)) - NOW).toBe(86_400_000);
  });
  it('stop opts the person out and sends nothing', async () => {
    const { db, writes } = await setup();
    await ingestMessages(db, [{ ig_user_id: '99', sender_id: 'u1', mid: 'm2', text: 'stop' }], NOW);
    expect(writes.some((w) => w.table === 'dm_jobs')).toBe(false);
    expect(writes.some((w) => w.table === 'contacts' && w.data.opted_out === true)).toBe(true);
  });
  it('backup polling finds a reply and counts the 24h from the reply time', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [{ messages: { data: [{ from: { id: 'u1' }, created_time: '2026-11-24T09:35:29+0000', message: 'yes' }, { from: { id: '99' }, created_time: '2026-11-24T07:00:05+0000', message: 'gate' }] } }] }), { status: 200 }));
    const { db, writes } = await setup();
    await pollGates(db, env, NOW, []);
    const job = writes.find((w) => w.table === 'dm_jobs')?.data;
    expect(job?.stage).toBe('link');
    expect(Date.parse(String(job?.deadline_at))).toBe(Date.parse('2026-11-24T09:35:29.000Z') + 86_400_000);
  });
  it('polling is off unless live is switched on', async () => {
    const { db, writes } = await setup();
    expect(await pollGates(db, { ...env, LIVE_ENABLED: undefined }, NOW, [])).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
