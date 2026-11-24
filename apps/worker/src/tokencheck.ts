import { decryptToken } from './crypto.js';
import { debugToken, getIgUser, getSubscribedFields, subscribeWebhooks } from './instagram.js';
import type { Db } from './db.js';
import type { Env } from './index.js';

const clean = (v: string | undefined) => (v ?? '').trim();

/** Read-only token health check, at most once per 6 hours. Never stores or prints the token. */
export async function tokenCheck(db: Db, env: Env, now: number, log: string[]): Promise<void> {
  const [last] = await db.select<{ at: string }>('heartbeat', 'name=eq.tokencheck&select=at&limit=1');
  if (last && now - Date.parse(last.at) < 6 * 3_600_000) return;
  const rows = await db.select<{ account_id: string; token_enc: string }>('account_tokens', 'select=account_id,token_enc&limit=1');
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const acc8 = r.account_id.slice(0, 8);
    try {
      const token = await decryptToken(r.token_enc, clean(env.TOKEN_KEY));
      const [acc] = await db.select<{ ig_user_id: string }>('accounts', `id=eq.${r.account_id}&select=ig_user_id&limit=1`);
      const d = await debugToken(clean(env.META_APP_ID), clean(env.APP_SECRET), token);
      const ig = acc ? await getIgUser(acc.ig_user_id, token) : null;
      const subs = acc ? await getSubscribedFields(acc.ig_user_id, token) : null;
      const resub = acc && subs && !subs.includes('messages') ? await subscribeWebhooks(acc.ig_user_id, token) : null;
      out.push({ acc: acc8, valid: d.valid, type: d.type, expires_at: d.expiresAt, scopes: d.scopes, ig, subs, resub });
      if (d.expiresAt !== null) await db.update('account_tokens', `account_id=eq.${r.account_id}`, { expires_at: new Date(d.expiresAt === 0 ? 4_102_444_800_000 : d.expiresAt * 1000).toISOString() });
    } catch (e) { out.push({ acc: acc8, error: String(e).slice(0, 120) }); }
  }
  log.push(`tokencheck ${out.length}`);
  await db.insert('heartbeat', { name: 'tokencheck', at: new Date(now).toISOString(), info: out }, { onConflict: 'name' });
}
