import { AccountQueue, DEFAULT_SAFETY, compose, emptyState } from '../../../packages/core/src/index.js';
import type { Db } from './db.js';

interface Acc { id: string; workspace_id: string; mode: string; status: string; gap_seconds?: number | null }
interface Job { id: string; comment_id: string; campaign_id: string | null; from_id: string | null; username: string | null; reel_id: string | null; comment_at: string }
interface Camp { id: string; link_url: string; variants: string[]; template: string }
interface Hist { from_id: string | null; reel_id: string | null; sent_at: string }
interface QState { account_id: string; state: { nextAllowedAt?: number; runStart?: number | null }; updated_at: string }

const DAY = 86_400_000;
const WINDOW = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const inList = (ids: string[]) => `in.(${ids.join(',')})`;

/** Dry-run: same queue rules as Live (gap, caps, breaks, quiet hours, 7 day deadline), but nothing is sent. */
export async function runDryRun(raw: Db, now = Date.now(), budget = 40, log: string[] = []): Promise<number> {
  let calls = 0;
  const db: Db = {
    select: <T,>(t: string, q: string) => { calls++; return raw.select<T>(t, q); },
    insert: (t, r, o) => { calls++; return raw.insert(t, r, o); },
    update: (t, q, p) => { calls++; return raw.update(t, q, p); },
  };
  const pending = await db.select<{ account_id: string }>('dm_jobs', 'status=eq.queued&select=account_id&limit=1000');
  const ids = [...new Set(pending.map((p) => p.account_id))];
  log.push(`pending ${pending.length}`);
  if (ids.length === 0) return 0;
  const states = new Map((await db.select<QState>('queue_state', `account_id=${inList(ids)}&select=*`)).map((s) => [s.account_id, s]));
  ids.sort((a, b) => Date.parse(states.get(a)?.updated_at ?? '1970-01-01') - Date.parse(states.get(b)?.updated_at ?? '1970-01-01'));

  let total = 0;
  for (const id of ids) {
    if (calls > budget) break;
    const [acc] = await db.select<Acc>('accounts', `id=eq.${id}&select=*&limit=1`);
    if (!acc || acc.mode !== 'dry_run' || acc.status !== 'active') { log.push(`skip ${id.slice(0, 8)} ${acc ? `${acc.mode}/${acc.status}` : 'no account'}`); continue; }
    const jobs = await db.select<Job>('dm_jobs', `account_id=eq.${id}&status=eq.queued&order=comment_at.asc&limit=500&select=id,comment_id,campaign_id,from_id,username,reel_id,comment_at`);
    const hist = await db.select<Hist>('dm_jobs', `account_id=eq.${id}&status=in.(dry_run,sent)&sent_at=gte.${iso(now - DAY)}&order=sent_at.desc&limit=2000&select=from_id,reel_id,sent_at`);
    const optout = await db.select<{ ig_user_id: string }>('contacts', `account_id=eq.${id}&opted_out=eq.true&select=ig_user_id`);
    const camps = new Map((await db.select<Camp>('campaigns', `account_id=eq.${id}&select=id,link_url,variants,template`)).map((c) => [c.id, c]));

    const cfg = { ...DEFAULT_SAFETY, gapSec: acc.gap_seconds && acc.gap_seconds > 0 ? acc.gap_seconds : DEFAULT_SAFETY.gapSec };
    const saved = states.get(id)?.state ?? {};
    const sentAt = hist.map((h) => Date.parse(h.sent_at)).reverse();
    const lastDm = new Map<string, number>();
    for (const h of [...hist].reverse()) if (h.from_id) lastDm.set(h.from_id, Date.parse(h.sent_at));
    const q = new AccountQueue(cfg, Math.random);
    q.state = { ...emptyState(), sentAt, lastSentAt: sentAt.length ? sentAt[sentAt.length - 1]! : null, nextAllowedAt: saved.nextAllowedAt ?? 0, runStart: saved.runStart ?? null };
    q.seed(lastDm, hist[0]?.reel_id ?? null, optout.map((o) => o.ig_user_id));
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const j of jobs) q.enqueue(j.id, j.reel_id ?? 'none', j.from_id ?? j.id, Date.parse(j.comment_at));

    log.push(`acc ${id.slice(0, 8)} jobs=${jobs.length} hist=${hist.length} camps=${camps.size}`);
    const msgs = new Map<string, string>();
    let last = 'none';
    const sent: { id: string; commentId: string; at: number }[] = [];
    let t = now;
    for (let i = 0; i < 100; i++) {
      const s = q.step(t, (job) => {
        const row = byId.get(job.id);
        const camp = row?.campaign_id ? camps.get(row.campaign_id) : undefined;
        if (!row || !camp) return { ok: false, error: 'COMPOSE_FAILED' };
        const r = compose({ template: camp.template, link: camp.link_url, variants: camp.variants, username: row.username });
        if (!r.ok) return { ok: false, error: 'COMPOSE_FAILED' };
        msgs.set(job.id, r.text);
        return { ok: true };
      });
      last = s.kind === 'wait' ? `wait:${s.reason}` : s.kind;
      if (s.kind === 'sent') { sent.push({ id: s.job.id, commentId: byId.get(s.job.id)!.comment_id, at: t }); t += 1; }
      else if (s.kind === 'wait') { if (s.retryAt >= now + WINDOW) break; t = s.retryAt; }
      else if (s.kind !== 'failed') break;
    }

    log.push(`sent ${sent.length} last=${last}`);
    for (const s of sent) {
      const ok = await db.update('dm_jobs', `id=eq.${s.id}`, { status: 'dry_run', sent_at: iso(s.at), message: msgs.get(s.id), attempts: 1 });
      if (!ok) log.push(`update failed ${s.id.slice(0, 8)}`);
    }
    const done = q.all.filter((j) => j.status !== 'queued' && j.status !== 'sent');
    for (const j of done) {
      const error = j.status === 'expired' ? 'expired' : j.status === 'skipped' ? j.skipReason : 'compose_failed';
      await db.update('dm_jobs', `id=eq.${j.id}`, { status: j.status === 'failed' ? 'failed' : 'skipped', error });
    }
    const mark = async (status: string, list: string[]) => { if (list.length) await db.update('comments', `comment_id=${inList(list)}`, { status }); };
    await mark('dry_run', sent.map((s) => s.commentId));
    await mark('expired', done.filter((j) => j.status === 'expired').map((j) => byId.get(j.id)!.comment_id));
    await db.insert('queue_state', { account_id: id, state: { nextAllowedAt: q.state.nextAllowedAt, runStart: q.state.runStart }, updated_at: iso(now) }, { onConflict: 'account_id' });
    if (sent.length) {
      const day = new Date(now + 330 * 60_000).toISOString().slice(0, 10);
      const [m] = await db.select<{ dm_dry: number }>('metrics', `account_id=eq.${id}&day=eq.${day}&select=dm_dry&limit=1`);
      await db.insert('metrics', { workspace_id: acc.workspace_id, account_id: id, day, dm_dry: (m?.dm_dry ?? 0) + sent.length }, { onConflict: 'account_id,day' });
    }
    total += sent.length;
  }
  return total;
}
