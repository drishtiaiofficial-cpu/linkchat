export const MAX_WORDS = 25;
export const MAX_EMOJI = 1;
export const MAX_CHARS = 400;

const URLISH =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|me|io|co|ly|app|net|org|xyz|link|page|site|shop|store|info|biz|gl|to)\b(?:\/\S*)?/gi;

export const countWords = (t: string): number => t.trim().split(/\s+/).filter(Boolean).length;
export const countEmoji = (t: string): number => (t.match(/\p{Extended_Pictographic}/gu) ?? []).length;

export function validateLink(link: string): boolean {
  if (/\s/.test(link)) return false;
  try {
    return new URL(link).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Returns the list of problems. Empty list = message is safe to send. */
export function validateMessage(text: string, link: string): string[] {
  const reasons: string[] = [];
  if (text.trim().length === 0) return ['empty'];
  const parts = text.split(link);
  if (parts.length - 1 !== 1) reasons.push('link_missing_or_repeated');
  const rest = parts.join(' ');
  if (/https?:|www\./i.test(rest) || rest.match(URLISH)) reasons.push('extra_url');
  if (countWords(text) > MAX_WORDS) reasons.push('too_many_words');
  if (text.length > MAX_CHARS) reasons.push('too_long');
  if (countEmoji(text) > MAX_EMOJI) reasons.push('too_many_emoji');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(text)) reasons.push('control_chars');
  if (/[{}]/.test(text)) reasons.push('unfilled_placeholder');
  return reasons;
}

/** Usernames come from comments (untrusted data): accept only real handle shapes. */
export function safeName(username: string | null | undefined): string | null {
  return username && /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : null;
}

export function renderTemplate(template: string, link: string, name: string | null): string {
  let t = template.split('{name}').join(name ?? '');
  t = t.includes('{link}') ? t.split('{link}').join(link) : `${t.trimEnd()}\n${link}`;
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,!.?])/g, '$1').trim();
}

export interface ComposeInput {
  template: string;
  link: string;
  variants?: string[];
  username?: string | null;
  /** Optional AI re-word of a variant. Used only if it passes the validator. */
  aiCandidate?: string | null;
  rand?: () => number;
}

export type ComposeResult =
  | { ok: true; text: string; source: 'ai' | 'variant' | 'template' }
  | { ok: false; reasons: string[] };

/** The link is ALWAYS the saved campaign link. AI text is never trusted, only validated. */
export function compose(input: ComposeInput): ComposeResult {
  const { template, link } = input;
  if (!validateLink(link)) return { ok: false, reasons: ['bad_link'] };
  const name = safeName(input.username);

  if (input.aiCandidate && validateMessage(input.aiCandidate, link).length === 0) {
    return { ok: true, text: input.aiCandidate.trim(), source: 'ai' };
  }
  const good = (input.variants ?? [])
    .map((v) => renderTemplate(v, link, name))
    .filter((t) => validateMessage(t, link).length === 0);
  if (good.length > 0) {
    const rand = input.rand ?? Math.random;
    const pick = good[Math.min(good.length - 1, Math.floor(rand() * good.length))];
    if (pick !== undefined) return { ok: true, text: pick, source: 'variant' };
  }
  const text = renderTemplate(template, link, name);
  const reasons = validateMessage(text, link);
  return reasons.length === 0 ? { ok: true, text, source: 'template' } : { ok: false, reasons };
}
