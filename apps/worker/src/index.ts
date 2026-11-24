import { constantTimeEqual, describeNonComment, extractComments, extractMessages, verifySignature } from './webhook.js';
import { ingestMessages, pollGates } from './gates.js';
import { makeDb } from './db.js';
import { ingest } from './ingest.js';
import { runDryRun } from './dryrun.js';
import { connectStart, oauthCallback, refreshDue } from './oauth.js';
import { tokenCheck } from './tokencheck.js';
import { runLive } from './live.js';

export interface Env {
  APP_SECRET: string; VERIFY_TOKEN: string; SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string;
  META_APP_ID?: string; UNIFIED_CONFIG_ID?: string; LIVE_ENABLED?: string; TOKEN_KEY?: string; WEB_URL?: string;
}

const MAX_BODY = 1_000_000;
const clean = (v: string | undefined) => (v ?? '').trim();
const text = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/connect/start' || url.pathname === '/oauth/callback') {
    const d = makeDb(clean(env.SUPABASE_URL), clean(env.SUPABASE_SERVICE_KEY));
    return url.pathname === '/oauth/callback' ? oauthCallback(request, env, d) : connectStart(request, env, d);
  }
  if (request.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe') {
      const token = url.searchParams.get('hub.verify_token') ?? '';
      const expected = clean(env.VERIFY_TOKEN);
      if (expected && constantTimeEqual(token.trim(), expected)) return text(url.searchParams.get('hub.challenge') ?? '');
      return text('forbidden', 403);
    }
    if (url.searchParams.get('diag') === '1') {
      return text(JSON.stringify({
        app_secret_set: clean(env.APP_SECRET).length > 0, verify_token_len: clean(env.VERIFY_TOKEN).length,
        verify_token_raw_len: (env.VERIFY_TOKEN ?? '').length, supabase_url_set: clean(env.SUPABASE_URL).length > 0,
        service_key_set: clean(env.SUPABASE_SERVICE_KEY).length > 0,
      }));
    }
    return text('linkchat-bot ok');
  }
  if (request.method !== 'POST') return text('method not allowed', 405);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return text('too large', 413);
  if (!(await verifySignature(clean(env.APP_SECRET), raw, request.headers.get('x-hub-signature-256')))) return text('bad signature', 401);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return text('bad json', 400); }
  const other = describeNonComment(payload);
  if (other) {
    try { await makeDb(clean(env.SUPABASE_URL), clean(env.SUPABASE_SERVICE_KEY)).insert('heartbeat', { name: 'hook_other', at: new Date().toISOString(), info: other }, { onConflict: 'name' }); } catch { /* debug only */ }
  }
  const msgs = extractMessages(payload);
  if (msgs.length > 0) {
    try { await ingestMessages(makeDb(clean(env.SUPABASE_URL), clean(env.SUPABASE_SERVICE_KEY)), msgs); } catch (e) { console.log('messages failed', String(e).slice(0, 200)); }
  }
  const rows = extractComments(payload);
  if (rows.length === 0) return text('ok');

  const db = makeDb(clean(env.SUPABASE_URL), clean(env.SUPABASE_SERVICE_KEY));
  // DB failure returns 500 so Meta retries; comment_id is unique so a retry is safe.
  if (!(await db.insert('comments', rows, { onConflict: 'comment_id', ignoreDuplicates: true }))) return text('db error', 500);
  console.log('comments saved', rows.length);
  try { await ingest(db, rows); } catch (e) { console.log('ingest failed', String(e).slice(0, 200)); }
  return text('ok');
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => {
    ctx.waitUntil((async () => {
      const db = makeDb(clean(env.SUPABASE_URL), clean(env.SUPABASE_SERVICE_KEY));
      const log: string[] = [];
      let sent = 0;
      let error: string | null = null;
      let liveCalls = 0;
      try { liveCalls = await runLive(db, env, Date.now(), log); } catch (e) { log.push(`live error ${String(e).slice(0, 80)}`); }
      let pollCalls = 0;
      try { pollCalls = await pollGates(db, env, Date.now(), log); } catch (e) { log.push(`poll error ${String(e).slice(0, 80)}`); }
      try { sent = await runDryRun(db, Date.now(), Math.max(10, 40 - liveCalls - pollCalls), log); } catch (e) { error = String(e).slice(0, 300); }
      try { await tokenCheck(db, env, Date.now(), log); } catch (e) { log.push(`token check error ${String(e).slice(0, 80)}`); }
      try { await refreshDue(db, env, Date.now(), log); } catch (e) { log.push(`refresh error ${String(e).slice(0, 80)}`); }
      await db.insert('heartbeat', { name: 'cron', at: new Date().toISOString(), info: { sent, error, log: log.slice(0, 8) } }, { onConflict: 'name' });
    })());
  },
};
