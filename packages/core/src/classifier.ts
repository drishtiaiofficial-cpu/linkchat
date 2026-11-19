export type Lang = 'en' | 'hi' | 'hinglish' | 'emoji' | 'other' | 'unknown';
export type CommentType =
  | 'keyword' | 'anyone' | 'emoji_praise' | 'emoji_link' | 'emoji_unsure'
  | 'question' | 'spam' | 'optout';
export type CommentAction =
  | 'dm_link' | 'soft_dm' | 'public_emoji' | 'public_emoji_soft_dm'
  | 'inbox' | 'ignore' | 'optout' | 'none';

export interface ClassifyOptions {
  keywords: string[];
  mode: 'keyword' | 'anyone';
  defaultLang: Lang;
}

export interface Classification {
  type: CommentType;
  lang: Lang;
  replyLang: Lang;
  action: CommentAction;
  reason: string;
}

const HINGLISH = new Set([
  'kya', 'hai', 'hain', 'nahi', 'nhi', 'bhai', 'bhejo', 'bhej', 'bhejna', 'chahiye', 'chahie',
  'mujhe', 'mereko', 'mujhko', 'aap', 'apna', 'kaise', 'kaisa', 'kab', 'kitna', 'kitne', 'yaar',
  'dena', 'dedo', 'ka', 'ki', 'ko', 'mein', 'hum', 'tum', 'toh', 'bhi', 'aur', 'kar', 'karo',
  'karna', 'wala', 'wali', 'ye', 'yeh', 'woh', 'kyu', 'kyun', 'milega', 'batao', 'bata',
]);

const PRAISE = ['\u{1F525}', '\u2764', '\u{1F44F}', '\u{1F60D}', '\u{1F64C}', '\u{1F4AF}', '\u{1F44D}', '\u{1F4AA}', '\u{1F929}'];
const LINK_EMOJI = ['\u{1F447}', '\u{1F517}', '\u2753', '\u2754', '\u{1F4E9}', '\u{1F4E5}', '\u2B07', '\u{1F449}', '\u{1F53D}'];

const OPTOUT_PHRASES = ['stop', 'unsubscribe', 'opt out', 'optout', 'band karo', 'band kar', 'mat bhejo'];
const QUESTION_PHRASES = [
  'price', 'cost', 'kitna', 'kitne', 'kimat', 'refund', 'scam', 'fraud', 'fake', 'cheat',
  'paisa', 'paise', 'rupees', 'how much', 'how to', 'how do', 'kaise', 'kyu', 'kyun', 'why',
];
const SPAM_PHRASES = ['f4f', 'follow me', 'follow back', 'dm me', 'check my profile', 'earn money', 'promote'];
const SPAM_URL = /https?:\/\/|www\.|\.com\b|bit\.ly/i;

export function normalizeText(t: string): string {
  return t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

export function matchesKeyword(text: string, keywords: string[]): boolean {
  const norm = normalizeText(text);
  if (norm === '') return false;
  const padded = ` ${norm} `;
  const compact = norm.replace(/ /g, '');
  for (const k of keywords) {
    const kw = normalizeText(k);
    if (kw === '') continue;
    if (padded.includes(` ${kw} `)) return true;
    if (compact === kw.replace(/ /g, '')) return true;
  }
  return false;
}

export function detectLanguage(text: string): Lang {
  const letters = text.match(/[\p{L}\p{M}]/gu) ?? [];
  if (letters.length === 0) {
    return /\p{Extended_Pictographic}/u.test(text) ? 'emoji' : 'unknown';
  }
  const dev = letters.filter((c) => /[\u0900-\u097F]/.test(c)).length;
  const lat = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  if (dev / letters.length >= 0.5) return 'hi';
  if (lat / letters.length < 0.5) return 'other';
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  const markers = tokens.filter((t) => HINGLISH.has(t)).length;
  if (markers > 0 && markers * 3 >= tokens.length) return 'hinglish';
  return tokens.length <= 1 ? 'unknown' : 'en';
}

function hasPhrase(norm: string, phrases: string[]): boolean {
  const padded = ` ${norm} `;
  return phrases.some((p) => padded.includes(` ${p} `));
}

export function isOptOut(text: string): boolean {
  const norm = normalizeText(text);
  const tokens = norm === '' ? 0 : norm.split(' ').length;
  return tokens <= 4 && hasPhrase(norm, OPTOUT_PHRASES);
}

export function isSpam(text: string): boolean {
  return SPAM_URL.test(text) || hasPhrase(normalizeText(text), SPAM_PHRASES);
}

export function isQuestion(text: string): boolean {
  return /[?\u20B9$]/.test(text) || hasPhrase(normalizeText(text), QUESTION_PHRASES);
}

export function classifyEmoji(text: string): 'emoji_praise' | 'emoji_link' | 'emoji_unsure' | null {
  if (/[\p{L}\p{M}\p{N}]/u.test(text)) return null;
  const emo = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  if (emo.length === 0) return null;
  if (emo.some((e) => LINK_EMOJI.includes(e))) return 'emoji_link';
  if (emo.every((e) => PRAISE.includes(e))) return 'emoji_praise';
  return 'emoji_unsure';
}

export function classifyComment(text: string, opts: ClassifyOptions): Classification {
  const lang = detectLanguage(text);
  const replyLang: Lang = lang === 'unknown' ? opts.defaultLang : lang;
  const make = (type: CommentType, action: CommentAction, reason: string): Classification =>
    ({ type, lang, replyLang, action, reason });

  if (isOptOut(text)) return make('optout', 'optout', 'opt-out word found');
  if (isSpam(text)) return make('spam', 'ignore', 'spam pattern found');
  if (matchesKeyword(text, opts.keywords)) return make('keyword', 'dm_link', 'keyword matched');
  if (isQuestion(text)) return make('question', 'inbox', 'question or complaint goes to inbox');

  const emoji = classifyEmoji(text);
  if (emoji === 'emoji_praise') return make(emoji, 'public_emoji', 'praise emoji, emoji reply only');
  if (emoji === 'emoji_link') return make(emoji, 'public_emoji_soft_dm', 'emoji may mean send link');
  if (emoji === 'emoji_unsure') {
    return opts.mode === 'anyone'
      ? make(emoji, 'soft_dm', 'unsure emoji, soft DM, button decides')
      : make(emoji, 'none', 'unsure emoji in keyword mode');
  }
  return opts.mode === 'anyone'
    ? make('anyone', 'soft_dm', 'anyone mode, soft DM')
    : make('anyone', 'none', 'no keyword in keyword mode');
}
