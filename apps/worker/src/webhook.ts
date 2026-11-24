export interface CommentRow {
  comment_id: string;
  ig_user_id: string;
  media_id: string | null;
  parent_id: string | null;
  from_id: string | null;
  from_username: string | null;
  text: string;
  created_time: string | null;
  status: 'new' | 'ignored_self';
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(secret, body);
  return constantTimeEqual(expected, header.slice(7).toLowerCase());
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null);

// Comment text is DATA only. Nothing here ever treats it as an instruction.
export function extractComments(payload: unknown): CommentRow[] {
  const rows: CommentRow[] = [];
  if (!isObj(payload) || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return rows;
  for (const entry of payload.entry) {
    if (!isObj(entry)) continue;
    const igUserId = str(entry.id);
    if (!igUserId || !Array.isArray(entry.changes)) continue;
    const time = typeof entry.time === 'number' ? new Date(entry.time * 1000).toISOString() : null;
    for (const change of entry.changes) {
      if (!isObj(change) || change.field !== 'comments' || !isObj(change.value)) continue;
      const v = change.value;
      const commentId = str(v.id);
      if (!commentId) continue;
      const from = isObj(v.from) ? v.from : {};
      const media = isObj(v.media) ? v.media : {};
      const fromId = str(from.id);
      rows.push({
        comment_id: commentId,
        ig_user_id: igUserId,
        media_id: str(media.id),
        parent_id: str(v.parent_id),
        from_id: fromId,
        from_username: str(from.username),
        text: typeof v.text === 'string' ? v.text.slice(0, 2200) : '',
        created_time: time,
        status: fromId === igUserId ? 'ignored_self' : 'new',
      });
    }
  }
  return rows;
}

export interface MessageRow { ig_user_id: string; sender_id: string; mid: string | null; text: string }

/** Incoming DMs (a button tap or a reply). Our own echoes are dropped. Text is DATA only. */
export function extractMessages(payload: unknown): MessageRow[] {
  const rows: MessageRow[] = [];
  if (!isObj(payload) || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return rows;
  for (const entry of payload.entry) {
    if (!isObj(entry) || !Array.isArray(entry.messaging)) continue;
    const igUserId = str(entry.id);
    if (!igUserId) continue;
    for (const ev of entry.messaging) {
      if (!isObj(ev) || !isObj(ev.message) || !isObj(ev.sender)) continue;
      const senderId = str(ev.sender.id);
      if (!senderId || senderId === igUserId || ev.message.is_echo === true) continue;
      rows.push({ ig_user_id: igUserId, sender_id: senderId, mid: str(ev.message.mid), text: typeof ev.message.text === 'string' ? ev.message.text.slice(0, 500) : '' });
    }
  }
  return rows;
}
