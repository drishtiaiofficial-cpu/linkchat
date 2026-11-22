const V = 'v25.0';
const SCOPES = 'instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages';

export function authUrl(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES, state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${what} failed ${res.status}: ${JSON.stringify(body.error_message ?? body.error ?? '').slice(0, 150)}`);
  return body;
}

export async function exchangeCode(appId: string, secret: string, redirectUri: string, code: string): Promise<{ token: string }> {
  const form = new FormData();
  form.set('client_id', appId);
  form.set('client_secret', secret);
  form.set('grant_type', 'authorization_code');
  form.set('redirect_uri', redirectUri);
  form.set('code', code);
  const b = await readJson(await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form }), 'code exchange');
  const first = Array.isArray(b.data) ? (b.data[0] as Record<string, unknown> | undefined) : undefined;
  const token = (first?.access_token ?? b.access_token) as string | undefined;
  if (!token) throw new Error('no token in exchange response');
  return { token };
}

export async function longLived(secret: string, shortToken: string): Promise<{ token: string; expiresIn: number }> {
  const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: shortToken });
  const b = await readJson(await fetch(`https://graph.instagram.com/access_token?${q}`), 'long token');
  return { token: String(b.access_token), expiresIn: Number(b.expires_in ?? 5_184_000) };
}

export async function refreshToken(token: string): Promise<{ token: string; expiresIn: number }> {
  const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const b = await readJson(await fetch(`https://graph.instagram.com/refresh_access_token?${q}`), 'refresh');
  return { token: String(b.access_token), expiresIn: Number(b.expires_in ?? 5_184_000) };
}

export async function getMe(token: string): Promise<{ userId: string; username: string; accountType: string }> {
  const q = new URLSearchParams({ fields: 'user_id,username,account_type', access_token: token });
  const b = await readJson(await fetch(`https://graph.instagram.com/${V}/me?${q}`), 'me');
  return { userId: String(b.user_id), username: String(b.username), accountType: String(b.account_type) };
}

export async function subscribeWebhooks(token: string): Promise<boolean> {
  const q = new URLSearchParams({ subscribed_fields: 'comments,messages', access_token: token });
  return (await fetch(`https://graph.instagram.com/${V}/me/subscribed_apps?${q}`, { method: 'POST' })).ok;
}
