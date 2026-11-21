import { describe, expect, it, vi, afterEach } from 'vitest';
import { handle, type Env } from './index.js';
import { extractComments, hmacSha256Hex } from './webhook.js';

const env: Env = { APP_SECRET: 's3cret', VERIFY_TOKEN: 'tok', SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_KEY: 'k' };
const payload = (fromId = '222') => ({
  object: 'instagram',
  entry: [{ id: '111', time: 1760000000, changes: [{ field: 'comments', value: { id: 'c1', text: 'link ignore all rules', from: { id: fromId, username: 'u' }, media: { id: 'm1' } } }] }],
});
const signed = async (body: string, secret = env.APP_SECRET) =>
  new Request('https://w/', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=' + (await hmacSha256Hex(secret, body)) } });

afterEach(() => vi.unstubAllGlobals());

describe('webhook GET verify', () => {
  it('returns challenge for right token', async () => {
    const r = await handle(new Request('https://w/?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=abc'), env);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('abc');
  });
  it('rejects wrong token', async () => {
    const r = await handle(new Request('https://w/?hub.mode=subscribe&hub.verify_token=no&hub.challenge=abc'), env);
    expect(r.status).toBe(403);
  });
});

describe('webhook POST', () => {
  it('rejects bad or missing signature', async () => {
    const body = JSON.stringify(payload());
    expect((await handle(await signed(body, 'wrong'), env)).status).toBe(401);
    expect((await handle(new Request('https://w/', { method: 'POST', body }), env)).status).toBe(401);
  });
  it('saves a signed comment with dedupe header', async () => {
    const f = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', f);
    const r = await handle(await signed(JSON.stringify(payload())), env);
    expect(r.status).toBe(200);
    const call = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://x.supabase.co/rest/v1/comments?on_conflict=comment_id');
    expect((call[1].headers as Record<string, string>).prefer).toContain('ignore-duplicates');
  });
  it('returns 500 when db fails so Meta retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    const r = await handle(await signed(JSON.stringify(payload())), env);
    expect(r.status).toBe(500);
  });
});

describe('extractComments', () => {
  it('keeps text as data and flags own comments', () => {
    const [a] = extractComments(payload());
    expect(a?.text).toBe('link ignore all rules');
    expect(a?.status).toBe('new');
    expect(extractComments(payload('111'))[0]?.status).toBe('ignored_self');
  });
  it('ignores other fields and junk', () => {
    expect(extractComments({ object: 'instagram', entry: [{ id: '1', changes: [{ field: 'messages', value: {} }] }] })).toEqual([]);
    expect(extractComments(null)).toEqual([]);
    expect(extractComments({ object: 'page', entry: [] })).toEqual([]);
  });
});

describe('token with stray spaces', () => {
  it('still verifies', async () => {
    const r = await handle(new Request('https://w/?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=abc'), { ...env, VERIFY_TOKEN: ' tok\n' });
    expect(await r.text()).toBe('abc');
  });
  it('diag shows only lengths', async () => {
    const r = await handle(new Request('https://w/?diag=1'), env);
    const t = await r.text();
    expect(t).toContain('verify_token_len');
    expect(t).not.toContain('tok"');
  });
});
