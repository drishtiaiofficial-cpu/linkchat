import { constantTimeEqual, extractComments, verifySignature } from './webhook.js';
import { makeDb } from './db.js';
import { ingest } from './ingest.js';

export interface Env { APP_SECRET: string; VERIFY_TOKEN: string; SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }

const MAX_BODY = 1_000_000;
const clean = (v: string | undefined) => (v ?? '').trim();
const text = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
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
  const rows = extractComments(payload);
  if (rows.length === 0) return text('ok');

  const db = makeDb(clean(env.SUPABASE_URL), clean(env.SUPABASE_SERVICE_KEY));
  // DB failure returns 500 so Meta retries; comment_id is unique so a retry is safe.
  if (!(await db.insert('comments', rows, { onConflict: 'comment_id', ignoreDuplicates: true }))) return text('db error', 500);
  console.log('comments saved', rows.length);
  try { await ingest(db, rows); } catch (e) { console.log('ingest failed', String(e).slice(0, 200)); }
  return text('ok');
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
