import { AccountQueue, DEFAULT_SAFETY, compose, countEmoji, countWords, emptyState, safeName } from '../../../packages/core/src/index.js';
import { decryptToken } from './crypto.js';
import { sendDm, type DmTarget, type SendOutcome } from './instagram.js';
import type { Db } from './db.js';
import type { Env } from './index.js';

interface Acc { id: string; workspace_id: string; ig_user_id: string | null; gap_seconds?: number | null; live_since?: string | null; daily_cap?: number | null }
interface Job { id: string; comment_id: string; campaign_id: string | null; from_id: string | null; username: string | null; reel_id: string | null; comment_at: string; stage: string | null; recipient_id: string | null }
interface Camp { id: string; link_url: string; variants: string[]; template: string; flow?: string | null; gate_text?: string | null; gate_button?: string | null }
interface Hist { from_id: string | null; reel_id: string | null; sent_at: string }

const DAY = 86_400_000;
const STOP = new Set(['RATE_LIMIT', 'TOKEN_INVALID', 'BLOCKED']);
const iso = (ms: number) => new Date(ms).toISOString();
const clean = (v: string | undefined) => (v ?? '').trim();
const enc = encodeURIComponent;
const inList = (ids: string[]) => `in.(${ids.join(',')})`;

/** Warm-up: week 1 gap 40 / 300 a day, week 2 gap 30 / 800 a day; the user can only slow down, never speed up. */
export function liveConfig(acc: Acc, now: number) {
  const days = acc.live_since ? (now - Date.parse(acc.live_since)) / DAY : 0;
  let gap: number = DEFAULT_SAFETY.gapSec;
  let daily: number = DEFAULT_SAFETY.dailyCap;
  let hourly: number = DEFAULT_SAFETY.hourlyCap;
  if (days < 7) { gap = 40; daily = 300; hourly = 40; } else if (days < 14) { gap = 30; daily = 800; hourly = 80; }
  if (acc.gap_seconds && acc.gap_seconds > gap) gap = acc.gap_seconds;
  if (acc.daily_cap && acc.daily_cap > 0) daily = Math.min(daily, acc.daily_cap);
  return { ...DEFAULT_SAFETY, gapSec: gap, dailyCap: daily, hourlyCap: hourly };
}

/** First message of the button flow: never contains a link. A custom text is used only if it is clean. */
export function gateText(camp: Camp, username: string | null): string {
  const name = safeName(username);
  const custom = (camp.gate_text ?? '').trim();
  const bad = /https?:|www\.|\w\.(com|in|me|io|link|app|co)\b/i.test(custom);
  if (custom && custom.length <= 400 && countWords(custom) <= 25 && countEmoji(custom) <= 1 && !bad) return custom.split('{name}').join(name ?? 'there');
  return `Hey${name ? ` ${name}` : ''}! Want the link? Tap the button below.`;
}
const buttonTitle = (camp: Camp): string => (camp.gate_button ?? '').trim().slice(0, 20) || 'Send me the link';

/** Live sending: at most one DM per account per cron tick. Off unless the LIVE_ENABLED secret is "true". Returns DB calls used. */
export async function runLive(raw: Db, env: Env, now: number, log: string[]): Promise<number> {
  if (clean(env.LIVE_ENABLED) !== 'true') return 0;
  let calls = 0;
  const db: Db = {
    select: <T,>(t: string, q: string) => { calls++; return raw.select<T>(t, q); },
    insert: (t, r, o) => { calls++; return raw.insert(t, r, o); },
    update: (t, q, p) => { calls++; return raw.update(t, q, p); },
  };
  const accs = await db.select<Acc>('accounts', 'mode=eq.live&status=eq.active&select=*&limit=2');
  for (const acc of accs) {
    try { await liveOne(db, env, acc, now, log); } catch (e) { log.push(`live error ${acc.id.slice(0, 8)} ${String(e).slice(0, 80)}`); }
  }
  return calls;
}

async function liveOne(db: Db, env: Env, acc: Acc, now: number, log: string[]): Promise<void> {
  const id = acc.id;
  const tag = id.slice(0, 8);
  const stop = async (why: string) => { await db.update('accounts', `id=eq.${id}`, { mode: 'dry_run' }); log.push(`LIVE STOPPED ${tag} ${why}`); };
  if (!acc.ig_user_id) { log.push(`live ${tag} no ig id`); return; }
  const jobs = await db.select<Job>('dm_jobs', `account_id=eq.${id}&status=eq.queued&order=comment_at.asc&limit=200&select=id,comment_id,campaign_id,from_id,username,reel_id,comment_at,stage,recipient_id`);
  if (jobs.length === 0) return;
  const recent = await db.select<{ status: string; error: string | null }>('dm_jobs', `account_id=eq.${id}&status=in.(sent,failed)&order=sent_at.desc.nullslast&limit=20&select=status,error`);
  if (recent.filter((r) => r.status === 'failed' && r.error !== 'compose_failed' && r.error !== 'sending').length >= 3) { await stop('3 failures in last 20'); return; }
  const [tokRow] = await db.select<{ token_enc: string }>('account_tokens', `account_id=eq.${id}&select=token_enc&limit=1`);
  if (!tokRow) { log.push(`live ${tag} no token`); return; }
  const token = await decryptToken(tokRow.token_enc, clean(env.TOKEN_KEY));
  const hist = await db.select<Hist>('dm_jobs', `account_id=eq.${id}&status=eq.sent&sent_at=gte.${iso(now - DAY)}&order=sent_at.desc&limit=2000&select=from_id,reel_id,sent_at`);
  const optout = await db.select<{ ig_user_id: string }>('contacts', `account_id=eq.${id}&opted_out=eq.true&select=ig_user_id`);
  const camps = new Map((await db.select<Camp>('campaigns', `account_id=eq.${id}&select=id,link_url,variants,template,flow,gate_text,gate_button`)).map((c) => [c.id, c]));
  const [qs] = await db.select<{ state: { nextAllowedAt?: number; runStart?: number | null } }>('queue_state', `account_id=eq.${id}&select=state&limit=1`);
  const saved = qs?.state ?? {};

  const sentAt = hist.map((h) => Date.parse(h.sent_at)).reverse();
  const lastDm = new Map<string, number>();
  for (const h of [...hist].reverse()) if (h.from_id) lastDm.set(h.from_id, Date.parse(h.sent_at));
  const q = new AccountQueue(liveConfig(acc, now), Math.random);
  q.state = { ...emptyState(), sentAt, lastSentAt: sentAt.length ? sentAt[sentAt.length - 1]! : null, nextAllowedAt: saved.nextAllowedAt ?? 0, runStart: saved.runStart ?? null };
  q.seed(lastDm, hist[0]?.reel_id ?? null, optout.map((o) => o.ig_user_id));
  const byId = new Map(jobs.map((j) => [j.id, j]));
  // The link message of the button flow is a reply to a person who already answered, so it has its own person key.
  for (const j of jobs) q.enqueue(j.id, j.reel_id ?? 'none', j.stage === 'link' ? `${j.from_id ?? j.id}#link` : j.from_id ?? j.id, Date.parse(j.comment_at));

  const p = q.prepare(now);
  log.push(`live ${tag} jobs=${jobs.length} ${p.kind}${p.kind === 'wait' ? `:${p.reason}` : ''}`);
  let stopWhy: string | null = null;
  if (p.kind === 'ready') {
    const row = byId.get(p.job.id)!;
    const isLink = row.stage === 'link';
    const camp = row.campaign_id ? camps.get(row.campaign_id) : undefined;
    const useGate = !isLink && camp?.flow === 'gate';
    const r = camp && !useGate ? compose({ template: camp.template, link: camp.link_url, variants: camp.variants, username: row.username }) : null;
    const text = !camp ? null : useGate ? gateText(camp, row.username) : r && r.ok ? r.text : null;
    if (!camp || !text || (isLink && !row.recipient_id)) {
      q.complete(p.job, { ok: false, error: 'COMPOSE_FAILED' }, now);
      await db.update('dm_jobs', `id=eq.${row.id}`, { status: 'failed', error: 'compose_failed' });
    } else if (await db.update('dm_jobs', `id=eq.${row.id}`, { status: 'failed', error: 'sending', message: text, attempts: 1 })) {
      // Marked before the Meta call: a crash can never cause a second DM for the same job.
      const to: DmTarget = isLink ? { userId: row.recipient_id! } : { commentId: row.comment_id };
      let res: SendOutcome;
      let via = 'text';
      if (useGate) {
        res = await sendDm(acc.ig_user_id, token, to, { text, quick_replies: [{ content_type: 'text', title: buttonTitle(camp), payload: 'LINK' }] });
        via = 'button';
        if (!res.ok && res.error === 'SEND_FAILED') { res = await sendDm(acc.ig_user_id, token, to, { text: `${text} Reply YES.` }); via = 'text'; }
      } else res = await sendDm(acc.ig_user_id, token, to, { text });
      q.complete(p.job, res.ok ? { ok: true } : { ok: false, error: res.error }, now);
      await db.update('dm_jobs', `id=eq.${row.id}`, res.ok ? { status: 'sent', sent_at: iso(now), error: null } : { status: 'failed', sent_at: iso(now), error: res.detail });
      if (!isLink) await db.update('comments', `comment_id=eq.${enc(row.comment_id)}`, { status: res.ok ? 'sent' : 'failed' });
      if (res.ok && useGate && row.from_id) {
        await db.insert('dm_gates', { workspace_id: acc.workspace_id, account_id: id, dm_job_id: row.id, comment_id: row.comment_id, igsid: row.from_id, campaign_id: camp.id, username: row.username, reel_id: row.reel_id, status: 'waiting', via });
      }
      if (res.ok && isLink) await db.update('dm_gates', `account_id=eq.${id}&comment_id=eq.${enc(row.comment_id.replace(/:link$/, ''))}`, { status: 'delivered', delivered_at: iso(now) });
      if (!res.ok && STOP.has(res.error)) stopWhy = res.error;
      log.push(res.ok ? `sent ${tag} ${isLink ? 'link' : useGate ? `gate:${via}` : 'direct'}` : `send failed ${tag} ${res.detail}`);
    }
  }
  const gone = q.all.filter((j) => j.status === 'expired' || j.status === 'skipped');
  for (const j of gone) await db.update('dm_jobs', `id=eq.${j.id}`, { status: 'skipped', error: j.status === 'expired' ? 'expired' : j.skipReason });
  const expired = gone.filter((j) => j.status === 'expired').map((j) => byId.get(j.id)!).filter((j) => j.stage !== 'link').map((j) => j.comment_id);
  if (expired.length) await db.update('comments', `comment_id=${inList(expired)}`, { status: 'expired' });
  await db.insert('queue_state', { account_id: id, state: { nextAllowedAt: q.state.nextAllowedAt, runStart: q.state.runStart }, updated_at: iso(now) }, { onConflict: 'account_id' });
  if (stopWhy) await stop(stopWhy);
}
