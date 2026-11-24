import { isOptOut } from '../../../packages/core/src/index.js';
import { decryptToken } from './crypto.js';
import { listRecentFromUser } from './instagram.js';
import type { Db } from './db.js';
import type { Env } from './index.js';
import type { MessageRow } from './webhook.js';

const DAY = 86_400_000;
const enc = encodeURIComponent;
const iso = (ms: number) => new Date(ms).toISOString();
const clean = (v: string | undefined) => (v ?? '').trim();

interface Acc { id: string; workspace_id: string; status: string; mode?: string; ig_user_id?: string }
interface Gate { id: string; comment_id: string; campaign_id: string | null; username: string | null; reel_id: string | null }

/** A person answered our button message: queue the link DM. The 24h window counts from their reply. Text only matters for opt-out. */
async function applyReply(db: Db, acc: Acc, g: Gate, senderId: string, text: string, at: number): Promise<string> {
  if (isOptOut(text)) {
    await db.update('dm_gates', `id=eq.${g.id}`, { status: 'optout', replied_at: iso(at) });
    await db.insert('contacts', { workspace_id: acc.workspace_id, account_id: acc.id, ig_user_id: senderId, username: g.username, opted_out: true }, { onConflict: 'account_id,ig_user_id' });
    return 'optout';
  }
  if (!(await db.update('dm_gates', `id=eq.${g.id}&status=eq.waiting`, { status: 'ready', replied_at: iso(at) }))) return 'gate_update_failed';
  // comment_at is set 6 days back so the normal 7 day rule becomes a 24h deadline from the reply.
  await db.insert('dm_jobs', {
    workspace_id: acc.workspace_id, account_id: acc.id, comment_id: `${g.comment_id}:link`, campaign_id: g.campaign_id, status: 'queued',
    stage: 'link', recipient_id: senderId, from_id: senderId, username: g.username, reel_id: g.reel_id,
    deadline_at: iso(at + DAY), comment_at: iso(at - 6 * DAY), decision: { stage: 'link' },
  }, { onConflict: 'comment_id', ignoreDuplicates: true });
  return 'queued';
}

async function one(db: Db, m: MessageRow, now: number): Promise<string> {
  const [acc] = await db.select<Acc>('accounts', `ig_user_id=eq.${enc(m.ig_user_id)}&select=id,workspace_id,status&limit=1`);
  if (!acc || acc.status !== 'active') return 'no_account';
  const [g] = await db.select<Gate>('dm_gates', `account_id=eq.${acc.id}&igsid=eq.${enc(m.sender_id)}&status=eq.waiting&order=created_at.desc&limit=1&select=id,comment_id,campaign_id,username,reel_id`);
  if (!g) return 'no_gate';
  return applyReply(db, acc, g, m.sender_id, m.text, now);
}

export async function ingestMessages(db: Db, msgs: MessageRow[], now = Date.now()): Promise<void> {
  for (const m of msgs) {
    let out: string;
    try { out = await one(db, m, now); } catch (e) { out = `error ${String(e).slice(0, 60)}`; }
    await db.insert('heartbeat', { name: 'msg_debug', at: iso(now), info: { out, sender: m.sender_id, ig: m.ig_user_id, text: m.text.slice(0, 30), mid: m.mid } }, { onConflict: 'name' });
  }
}

/** Backup for missing webhooks: each tick looks at one waiting gate (oldest poll first) and asks Meta if the person replied. Returns DB calls used. */
export async function pollGates(raw: Db, env: Env, now: number, log: string[]): Promise<number> {
  if (clean(env.LIVE_ENABLED) !== 'true') return 0;
  let calls = 0;
  const db: Db = {
    select: <T,>(t: string, q: string) => { calls++; return raw.select<T>(t, q); },
    insert: (t, r, o) => { calls++; return raw.insert(t, r, o); },
    update: (t, q, p) => { calls++; return raw.update(t, q, p); },
  };
  const [g] = await db.select<Gate & { account_id: string; igsid: string; created_at: string }>('dm_gates', `status=eq.waiting&created_at=gte.${iso(now - 3 * DAY)}&order=polled_at.asc.nullsfirst&limit=1&select=id,account_id,comment_id,campaign_id,username,reel_id,igsid,created_at`);
  if (!g) return calls;
  await db.update('dm_gates', `id=eq.${g.id}`, { polled_at: iso(now) });
  const [acc] = await db.select<Acc>('accounts', `id=eq.${g.account_id}&select=id,workspace_id,status,mode,ig_user_id&limit=1`);
  if (!acc || acc.status !== 'active' || acc.mode !== 'live' || !acc.ig_user_id) return calls;
  const [tok] = await db.select<{ token_enc: string }>('account_tokens', `account_id=eq.${acc.id}&select=token_enc&limit=1`);
  if (!tok) return calls;
  const msgs = await listRecentFromUser(acc.ig_user_id, g.igsid, await decryptToken(tok.token_enc, clean(env.TOKEN_KEY)));
  if (!msgs) { log.push('poll api failed'); return calls; }
  const since = Date.parse(g.created_at);
  const reply = msgs.filter((m) => m.from === g.igsid && m.at > since).sort((a, b) => a.at - b.at)[0];
  if (!reply) { log.push('poll none'); return calls; }
  log.push(`poll ${await applyReply(db, acc, g, g.igsid, reply.text, reply.at)}`);
  return calls;
}
