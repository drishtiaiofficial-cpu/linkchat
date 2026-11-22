import { describe, it, expect } from 'vitest';
import { runDryRun } from './dryrun.js';
import type { Db } from './db.js';

const NOW = Date.parse('2026-11-22T14:00:00.000Z'); // 19:30 IST, not quiet hours
const job = (id: string, user: string) => ({ id, comment_id: `c${id}`, account_id: 'a1', campaign_id: 'k1', from_id: user, username: user, reel_id: 'r1', comment_at: '2026-11-22T13:50:00.000Z' });
const camp = { id: 'k1', link_url: 'https://example.com/x', variants: ['Hey {name} {link}'], template: 'Hi {link}' };

async function run(mode: string) {
  const writes: { table: string; data: Record<string, unknown> }[] = [];
  const db: Db = {
    select: async <T,>(t: string, q: string) => {
      if (t === 'dm_jobs') return (q.includes('status=in.') ? [] : [job('1', 'u1'), job('2', 'u2')]) as T[];
      if (t === 'accounts') return [{ id: 'a1', workspace_id: 'w1', mode, status: 'active' }] as T[];
      if (t === 'campaigns') return [camp] as T[];
      return [] as T[];
    },
    insert: async (table, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
    update: async (table, _q, data) => { writes.push({ table, data: data as Record<string, unknown> }); return true; },
  };
  const n = await runDryRun(db, NOW);
  return { n, writes };
}

describe('dry-run', () => {
  it('writes the message it would send, with the saved link, and respects the gap', async () => {
    const { n, writes } = await run('dry_run');
    const sent = writes.filter((w) => w.table === 'dm_jobs' && w.data.status === 'dry_run');
    expect(n).toBeGreaterThan(0);
    expect(String(sent[0]?.data.message)).toContain('https://example.com/x');
    if (sent.length > 1) expect(Date.parse(String(sent[1]?.data.sent_at)) - Date.parse(String(sent[0]?.data.sent_at))).toBeGreaterThanOrEqual(15_000);
  });
  it('sends nothing for accounts that are not in dry-run mode', async () => {
    const { n, writes } = await run('live');
    expect(n).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
