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
