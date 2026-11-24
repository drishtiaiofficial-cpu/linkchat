import { describe, it, expect } from 'vitest';
import { ingestMessages } from './gates.js';
import type { Db } from './db.js';

const NOW = Date.parse('2026-11-24T14:00:00.000Z');
function setup() {
  const writes: { table: string; data: Record<string, unknown> }[] = [];
  const db: Db = {
    select: async <T,>(t: string) => {
      if (t === 'accounts') return [{ id: 'a1', workspace_id: 'w1', status: 'active' }] as T[];
      if (t === 'dm_gates') return [{ id: 'g1', comment_id: 'c1', campaign_id: 'k1', username: 'u1', reel_id: 'r1' }] as T[];
      return [] as T[];
    },
    insert: async (table, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
    update: async (table, _q, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
  };
  return { db, writes };
}

describe('button flow replies', () => {
  it('a tap or reply queues the link job with a 24h deadline', async () => {
    const { db, writes } = setup();
    await ingestMessages(db, [{ ig_user_id: '99', sender_id: 'u1', mid: 'm1', text: 'Send me the link' }], NOW);
    const job = writes.find((w) => w.table === 'dm_jobs')?.data;
    expect(job?.stage).toBe('link');
    expect(job?.comment_id).toBe('c1:link');
    expect(Date.parse(String(job?.deadline_at)) - NOW).toBe(86_400_000);
  });
  it('stop opts the person out and sends nothing', async () => {
    const { db, writes } = setup();
    await ingestMessages(db, [{ ig_user_id: '99', sender_id: 'u1', mid: 'm2', text: 'stop' }], NOW);
    expect(writes.some((w) => w.table === 'dm_jobs')).toBe(false);
    expect(writes.some((w) => w.table === 'contacts' && w.data.opted_out === true)).toBe(true);
  });
});
