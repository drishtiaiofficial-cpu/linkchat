const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(tokenKey: string): Promise<CryptoKey> {
  const raw = unb64(tokenKey.trim());
  if (raw.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes in base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plain: string, tokenKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(tokenKey), new TextEncoder().encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptToken(blob: string, tokenKey: string): Promise<string> {
  const [v, iv, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('bad token blob');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(tokenKey), unb64(ct));
  return new TextDecoder().decode(pt);
}
