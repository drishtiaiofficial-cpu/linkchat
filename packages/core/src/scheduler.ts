import { DEFAULT_SAFETY, HARD_FLOOR_SEC, type SafetyConfig } from './safety.js';

const DAY = 86_400_000;

export interface Job {
  id: string;
  reelId: string;
  commentAt: number;
  deadlineAt: number;
}

export function splitExpired(jobs: Job[], now: number): { live: Job[]; expired: Job[] } {
  const live: Job[] = [];
  const expired: Job[] = [];
  for (const j of jobs) (now > j.deadlineAt ? expired : live).push(j);
  return { live, expired };
}

/** Round-robin across reels; inside a reel the nearest deadline goes first. */
export function pickNext(live: Job[], lastReelId: string | null): Job | null {
  if (live.length === 0) return null;
  const reels = [...new Set(live.map((j) => j.reelId))].sort();
  const next = lastReelId === null ? reels[0] : (reels.find((r) => r > lastReelId) ?? reels[0]);
  const inReel = live.filter((j) => j.reelId === next);
  return inReel.reduce((a, b) => (b.deadlineAt < a.deadlineAt ? b : a));
}

function quietLength(cfg: SafetyConfig): number {
  const { quietStartHour: s, quietEndHour: e } = cfg;
  if (s === e) return 0;
  return s < e ? e - s : 24 - s + e;
}

export function sendsPerHour(cfg: SafetyConfig = DEFAULT_SAFETY): number {
  const gap = Math.max(cfg.gapSec, HARD_FLOOR_SEC);
  const duty = cfg.breakAfterMin / (cfg.breakAfterMin + cfg.breakMin);
  return Math.min(cfg.hourlyCap, Math.floor((3600 / gap) * duty));
}

export function sendsPerDay(cfg: SafetyConfig = DEFAULT_SAFETY): number {
  return Math.min(cfg.dailyCap, sendsPerHour(cfg) * (24 - quietLength(cfg)));
}

export function forecastDays(count: number, cfg: SafetyConfig = DEFAULT_SAFETY): number {
  return count / sendsPerDay(cfg);
}

export function willMissDeadline(count: number, cfg: SafetyConfig, deadlineAt: number, now: number): boolean {
  return now + forecastDays(count, cfg) * DAY > deadlineAt;
}
