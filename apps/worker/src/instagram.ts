const V = 'v27.0';
const G = `https://graph.facebook.com/${V}`;

export function authUrl(appId: string, configId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: appId, config_id: configId, display: 'popup', override_default_response_type: 'true', redirect_uri: redirectUri, response_type: 'code', state, prompt: 'login' });
  return `https://www.facebook.com/dialog/oauth?${q}`;
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${what} failed ${res.status}: ${JSON.stringify(body.error ?? '').slice(0, 150)}`);
  return body;
}

export async function exchangeCode(appId: string, secret: string, redirectUri: string, code: string): Promise<{ token: string; expiresIn: number | null }> {
  const q = new URLSearchParams({ client_id: appId, client_secret: secret, redirect_uri: redirectUri, code });
  const b = await readJson(await fetch(`${G}/oauth/access_token?${q}`), 'code exchange');
  const token = b.access_token as string | undefined;
  if (!token) throw new Error('no token in exchange response');
  return { token, expiresIn: typeof b.expires_in === 'number' ? b.expires_in : null };
}

export async function getAccounts(token: string): Promise<{ id: string; username: string }[]> {
  const q = new URLSearchParams({ fields: 'id,username', access_token: token });
  const b = await readJson(await fetch(`${G}/me/assigned_instagram_accounts?${q}`), 'accounts');
  const data = Array.isArray(b.data) ? (b.data as Record<string, unknown>[]) : [];
  return data.filter((d) => d.id).map((d) => ({ id: String(d.id), username: String(d.username ?? '') }));
}

export async function subscribeWebhooks(igId: string, token: string): Promise<boolean> {
  const q = new URLSearchParams({ subscribed_fields: 'comments,messages', access_token: token });
  return (await fetch(`${G}/${igId}/subscribed_apps?${q}`, { method: 'POST' })).ok;
}

export async function debugToken(appId: string, secret: string, token: string): Promise<{ valid: boolean; type: string; expiresAt: number | null; scopes: string[] }> {
  const q = new URLSearchParams({ input_token: token, access_token: `${appId}|${secret}` });
  const b = await readJson(await fetch(`${G}/debug_token?${q}`), 'debug token');
  const d = (b.data ?? {}) as Record<string, unknown>;
  return { valid: d.is_valid === true, type: String(d.type ?? ''), expiresAt: typeof d.expires_at === 'number' ? d.expires_at : null, scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [] };
}

export async function getIgUser(igId: string, token: string): Promise<{ ok: boolean; status: number; username: string }> {
  const q = new URLSearchParams({ fields: 'id,username', access_token: token });
  const res = await fetch(`${G}/${igId}?${q}`);
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, username: String(b.username ?? '') };
}

export type SendOutcome = { ok: true } | { ok: false; error: string; detail: string };
export type DmTarget = { commentId: string } | { userId: string };

export async function sendDm(igId: string, token: string, to: DmTarget, message: Record<string, unknown>): Promise<SendOutcome> {
  const q = new URLSearchParams({ access_token: token });
  const recipient = 'commentId' in to ? { comment_id: to.commentId } : { id: to.userId };
  let res: Response;
  try {
    res = await fetch(`${G}/${igId}/messages?${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipient, message }) });
  } catch { return { ok: false, error: 'NETWORK', detail: 'network' }; }
  if (res.ok) return { ok: true };
  const b = (await res.json().catch(() => ({}))) as { error?: { code?: number; error_subcode?: number; message?: string } };
  const code = b.error?.code ?? 0;
  const detail = `${res.status}/${code}/${b.error?.error_subcode ?? 0} ${String(b.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 150)}`.trim();
  if (res.status === 429 || [4, 17, 32, 613].includes(code)) return { ok: false, error: 'RATE_LIMIT', detail };
  if (code === 190 || code === 102) return { ok: false, error: 'TOKEN_INVALID', detail };
  if (code === 368) return { ok: false, error: 'BLOCKED', detail };
  return { ok: false, error: 'SEND_FAILED', detail };
}

export const sendPrivateReply = (igId: string, token: string, commentId: string, text: string): Promise<SendOutcome> => sendDm(igId, token, { commentId }, { text });
