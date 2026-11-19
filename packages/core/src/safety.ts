export const HARD_FLOOR_SEC = 15;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const IST_OFFSET = 330 * MIN;

export interface SafetyConfig {
  gapSec: number;
  jitterSec: number;
  breakAfterMin: number;
  breakMin: number;
  hourlyCap: number;
  dailyCap: number;
  quietStartHour: number;
  quietEndHour: number;
}

export const DEFAULT_SAFETY: SafetyConfig = {
  gapSec: 20,
  jitterSec: 5,
  breakAfterMin: 30,
  breakMin: 5,
  hourlyCap: 120,
  dailyCap: 1500,
  quietStartHour: 1,
  quietEndHour: 6,
};

export interface SendState {
  sentAt: number[];
  lastSentAt: number | null;
  nextAllowedAt: number;
  runStart: number | null;
}

export type Decision =
  | { ok: true }
  | {
      ok: false;
      reason: 'quiet_hours' | 'gap' | 'break' | 'hourly_cap' | 'daily_cap';
      retryAt: number;
    };

export const emptyState = (): SendState => ({
  sentAt: [],
  lastSentAt: null,
  nextAllowedAt: 0,
  runStart: null,
});

export function clampConfig(cfg: SafetyConfig): SafetyConfig {
  return { ...cfg, gapSec: Math.max(cfg.gapSec, HARD_FLOOR_SEC), jitterSec: Math.max(0, cfg.jitterSec) };
}

export function nextGapMs(cfg: SafetyConfig, rand: () => number): number {
  const c = clampConfig(cfg);
  const sec = c.gapSec + (rand() * 2 - 1) * c.jitterSec;
  return Math.round(Math.max(HARD_FLOOR_SEC, sec) * 1000);
}

function istHour(ms: number): number {
  return Math.floor((((ms + IST_OFFSET) % DAY) + DAY) % DAY / HOUR);
}

export function isQuietHour(ms: number, cfg: SafetyConfig): boolean {
  const h = istHour(ms);
  const { quietStartHour: s, quietEndHour: e } = cfg;
  if (s === e) return false;
  return s < e ? h >= s && h < e : h >= s || h < e;
}

export function nextQuietEnd(ms: number, cfg: SafetyConfig): number {
  const istMs = ms + IST_OFFSET;
  const dayStart = Math.floor(istMs / DAY) * DAY;
  let end = dayStart + cfg.quietEndHour * HOUR;
  if (end <= istMs) end += DAY;
  return end - IST_OFFSET;
}

export function canSend(state: SendState, cfg: SafetyConfig, now: number): Decision {
  const c = clampConfig(cfg);
  if (isQuietHour(now, c)) return { ok: false, reason: 'quiet_hours', retryAt: nextQuietEnd(now, c) };
  if (now < state.nextAllowedAt) return { ok: false, reason: 'gap', retryAt: state.nextAllowedAt };
  if (state.runStart !== null && state.lastSentAt !== null) {
    const breakUntil = state.lastSentAt + c.breakMin * MIN;
    if (now - state.runStart >= c.breakAfterMin * MIN && now < breakUntil) {
      return { ok: false, reason: 'break', retryAt: breakUntil };
    }
  }
  const lastHour = state.sentAt.filter((t) => t > now - HOUR);
  if (lastHour.length >= c.hourlyCap) {
    return { ok: false, reason: 'hourly_cap', retryAt: Math.min(...lastHour) + HOUR };
  }
  const lastDay = state.sentAt.filter((t) => t > now - DAY);
  if (lastDay.length >= c.dailyCap) {
    return { ok: false, reason: 'daily_cap', retryAt: Math.min(...lastDay) + DAY };
  }
  return { ok: true };
}

export function recordSend(state: SendState, cfg: SafetyConfig, now: number, rand: () => number): SendState {
  const c = clampConfig(cfg);
  const fresh = state.lastSentAt !== null && now - state.lastSentAt >= c.breakMin * MIN;
  return {
    sentAt: [...state.sentAt.filter((t) => t > now - DAY), now],
    lastSentAt: now,
    nextAllowedAt: now + nextGapMs(c, rand),
    runStart: fresh || state.runStart === null ? now : state.runStart,
  };
}

export function canDmPerson(lastDmAt: number | null, now: number): boolean {
  return lastDmAt === null || now - lastDmAt >= DAY;
}

/** AI may only slow down: slower gap, fewer caps, earlier/longer breaks. Never faster. */
export function applyAiSuggestion(cfg: SafetyConfig, s: Partial<SafetyConfig>): SafetyConfig {
  return {
    ...cfg,
    gapSec: s.gapSec !== undefined ? Math.max(cfg.gapSec, s.gapSec) : cfg.gapSec,
    breakAfterMin: s.breakAfterMin !== undefined ? Math.min(cfg.breakAfterMin, s.breakAfterMin) : cfg.breakAfterMin,
    breakMin: s.breakMin !== undefined ? Math.max(cfg.breakMin, s.breakMin) : cfg.breakMin,
    hourlyCap: s.hourlyCap !== undefined ? Math.min(cfg.hourlyCap, s.hourlyCap) : cfg.hourlyCap,
    dailyCap: s.dailyCap !== undefined ? Math.min(cfg.dailyCap, s.dailyCap) : cfg.dailyCap,
  };
}

export const COMMENT_WINDOW_MS = 7 * DAY;
export const deadlineAt = (commentAt: number): number => commentAt + COMMENT_WINDOW_MS;
export const isExpired = (commentAt: number, now: number): boolean => now > deadlineAt(commentAt);
