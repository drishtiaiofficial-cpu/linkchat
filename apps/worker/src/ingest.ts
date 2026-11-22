import { classifyComment, COMMENT_WINDOW_MS, type Classification } from '../../../packages/core/src/index.js';
import type { Db } from './db.js';
import type { CommentRow } from './webhook.js';

interface Account { id: string; workspace_id: string; status: string; mode: string }
interface Campaign { id: string; media_id: string | null; keywords: string[]; link_url: string }
const DM_ACTIONS = new Set(['dm_link', 'soft_dm', 'public_emoji_soft_dm']);
const enc = encodeURIComponent;

// Comment text is DATA: only the rule classifier reads it. Nothing is sent here, a job is queued.
export async function ingest(db: Db, rows: CommentRow[], now = Date.now()): Promise<void> {
  for (const row of rows) {
    if (row.status !== 'new') continue;
    const mark = (status: string) => db.update('comments', `comment_id=eq.${enc(row.comment_id)}`, { status });
    const [account] = await db.select<Account>('accounts', `ig_user_id=eq.${enc(row.ig_user_id)}&select=id,workspace_id,status,mode&limit=1`);
    if (!account) { await mark('no_account'); continue; }
    if (account.status !== 'active') { await mark('account_paused'); continue; }
    if (!row.from_id) { await mark('ignored'); continue; }
    const all = await db.select<Campaign>('campaigns', `account_id=eq.${account.id}&status=eq.active&select=id,media_id,keywords,link_url`);
    const campaigns = all.filter((c) => c.media_id === null || c.media_id === row.media_id);
    if (campaigns.length === 0) { await mark('no_campaign'); continue; }

    let chosen: { campaign: Campaign; cls: Classification } | null = null;
    let first: Classification | null = null;
    for (const campaign of campaigns) {
      const cls = classifyComment(row.text, { keywords: campaign.keywords, mode: campaign.keywords.length > 0 ? 'keyword' : 'anyone', defaultLang: 'hinglish' });
      first ??= cls;
      if (DM_ACTIONS.has(cls.action)) { chosen = { campaign, cls }; break; }
    }
    const cls = chosen?.cls ?? first;
    if (!cls) { await mark('ignored'); continue; }

    if (cls.action === 'optout') {
      await db.insert('contacts', { workspace_id: account.workspace_id, account_id: account.id, ig_user_id: row.from_id, username: row.from_username, opted_out: true }, { onConflict: 'account_id,ig_user_id' });
      await mark('optout');
    } else if (cls.action === 'inbox') {
      await db.insert('inbox', { workspace_id: account.workspace_id, account_id: account.id, comment_id: row.comment_id, kind: cls.type, text: row.text });
      await mark('inbox');
    } else if (chosen) {
      const blocked = await db.select<{ id: string }>('contacts', `account_id=eq.${account.id}&ig_user_id=eq.${enc(row.from_id)}&opted_out=eq.true&select=id&limit=1`);
      if (blocked.length > 0) { await mark('optout'); continue; }
      const commentAt = row.created_time ? Date.parse(row.created_time) : now;
      await db.insert('dm_jobs', {
        workspace_id: account.workspace_id, account_id: account.id, comment_id: row.comment_id, campaign_id: chosen.campaign.id,
        status: 'queued', deadline_at: new Date(commentAt + COMMENT_WINDOW_MS).toISOString(), from_id: row.from_id,
        username: row.from_username, reel_id: row.media_id, comment_at: new Date(commentAt).toISOString(),
        decision: { type: cls.type, lang: cls.lang, action: cls.action, reason: cls.reason },
      }, { onConflict: 'comment_id', ignoreDuplicates: true });
      await mark('queued');
    } else {
      await mark('ignored');
    }
  }
}
