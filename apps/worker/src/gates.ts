import { isOptOut } from '../../../packages/core/src/index.js';
import type { Db } from './db.js';
import type { MessageRow } from './webhook.js';

const DAY = 86_400_000;
const enc = encodeURIComponent;
const iso = (ms: number) => new Date(ms).toISOString();

/** A person answered our button message: queue the link DM (24h window from their reply). Text only matters for opt-out. */
export async function ingestMessages(db: Db, msgs: MessageRow[], now = Date.now()): Promise<void> {
  for (const m of msgs) {
    const [acc] = await db.select<{ id: string; workspace_id: string; status: string }>('accounts', `ig_user_id=eq.${enc(m.ig_user_id)}&select=id,workspace_id,status&limit=1`);
    if (!acc || acc.status !== 'active') continue;
    const [g] = await db.select<{ id: string; comment_id: string; campaign_id: string | null; username: string | null; reel_id: string | null }>('dm_gates', `account_id=eq.${acc.id}&igsid=eq.${enc(m.sender_id)}&status=eq.waiting&order=created_at.desc&limit=1&select=id,comment_id,campaign_id,username,reel_id`);
    if (!g) continue;
    if (isOptOut(m.text)) {
      await db.update('dm_gates', `id=eq.${g.id}`, { status: 'optout', replied_at: iso(now) });
      await db.insert('contacts', { workspace_id: acc.workspace_id, account_id: acc.id, ig_user_id: m.sender_id, username: g.username, opted_out: true }, { onConflict: 'account_id,ig_user_id' });
      continue;
    }
    if (!(await db.update('dm_gates', `id=eq.${g.id}&status=eq.waiting`, { status: 'ready', replied_at: iso(now) }))) continue;
    // comment_at is set 6 days back so the normal 7 day rule becomes a 24h deadline from the reply.
    await db.insert('dm_jobs', {
      workspace_id: acc.workspace_id, account_id: acc.id, comment_id: `${g.comment_id}:link`, campaign_id: g.campaign_id, status: 'queued',
      stage: 'link', recipient_id: m.sender_id, from_id: m.sender_id, username: g.username, reel_id: g.reel_id,
      deadline_at: iso(now + DAY), comment_at: iso(now - 6 * DAY), decision: { stage: 'link' },
    }, { onConflict: 'comment_id', ignoreDuplicates: true });
  }
}
