import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SAFETY, HARD_FLOOR_SEC, applyAiSuggestion, canDmPerson, canSend, clampConfig,
  deadlineAt, emptyState, isExpired, nextGapMs, recordSend,
} from './safety.js';

const AFTERNOON = Date.UTC(2026, 10, 19, 10, 0); // 15:30 IST
const QUIET = Date.UTC(2026, 10, 19, 20, 0); // 01:30 IST
const HOUR = 3_600_000;
const half = () => 0.5;

describe('gap', () => {
  it('never goes below the 15s floor', () => {
    const cfg = { ...DEFAULT_SAFETY, gapSec: 1, jitterSec: 30 };
    expect(clampConfig(cfg).gapSec).toBe(HARD_FLOOR_SEC);
    for (const r of [0, 0.25, 0.5, 1]) expect(nextGapMs(cfg, () => r)).toBeGreaterThanOrEqual(15_000);
  });
  it('jitter stays within 15 to 25 s by default', () => {
    expect(nextGapMs(DEFAULT_SAFETY, () => 0)).toBe(15_000);
    expect(nextGapMs(DEFAULT_SAFETY, () => 0.5)).toBe(20_000);
    expect(nextGapMs(DEFAULT_SAFETY, () => 1)).toBe(25_000);
  });
  it('blocks a send that comes too early', () => {
    const st = recordSend(emptyState(), DEFAULT_SAFETY, AFTERNOON, half);
    expect(canSend(st, DEFAULT_SAFETY, AFTERNOON + 5_000)).toEqual({ ok: false, reason: 'gap', retryAt: AFTERNOON + 20_000 });
  });
});

describe('breaks and caps', () => {
  it('takes a 5 min break after 30 min of sending', () => {
    let st = emptyState();
    let t = AFTERNOON;
    while (t - AFTERNOON < 30 * 60_000) {
      expect(canSend(st, DEFAULT_SAFETY, t).ok).toBe(true);
      st = recordSend(st, DEFAULT_SAFETY, t, half);
      t += 20_000;
    }
    const breakEnd = t - 20_000 + 5 * 60_000;
    expect(canSend(st, DEFAULT_SAFETY, t)).toEqual({ ok: false, reason: 'break', retryAt: breakEnd });
    expect(canSend(st, DEFAULT_SAFETY, breakEnd).ok).toBe(true);
  });
  it('enforces the hourly cap', () => {
    const cfg = { ...DEFAULT_SAFETY, hourlyCap: 3 };
    let st = emptyState();
    for (let i = 0; i < 3; i++) st = recordSend(st, cfg, AFTERNOON + i * 20_000, half);
    expect(canSend(st, cfg, AFTERNOON + 60_000)).toEqual({ ok: false, reason: 'hourly_cap', retryAt: AFTERNOON + HOUR });
  });
  it('enforces the daily cap', () => {
    const cfg = { ...DEFAULT_SAFETY, dailyCap: 2 };
    let st = recordSend(emptyState(), cfg, AFTERNOON, half);
    st = recordSend(st, cfg, AFTERNOON + 2 * HOUR, half);
    expect(canSend(st, cfg, AFTERNOON + 3 * HOUR)).toEqual({ ok: false, reason: 'daily_cap', retryAt: AFTERNOON + 24 * HOUR });
  });
});

describe('quiet hours (IST)', () => {
  it('blocks 01:00 to 06:00 IST and resumes at 06:00', () => {
    const resume = Date.UTC(2026, 10, 20, 0, 30);
    expect(canSend(emptyState(), DEFAULT_SAFETY, QUIET)).toEqual({ ok: false, reason: 'quiet_hours', retryAt: resume });
    expect(canSend(emptyState(), DEFAULT_SAFETY, resume).ok).toBe(true);
  });
});

describe('per person and deadline', () => {
  it('allows max 1 DM per person per 24h', () => {
    expect(canDmPerson(null, AFTERNOON)).toBe(true);
    expect(canDmPerson(AFTERNOON, AFTERNOON + 23 * HOUR)).toBe(false);
    expect(canDmPerson(AFTERNOON, AFTERNOON + 24 * HOUR)).toBe(true);
  });
  it('expires a comment after 7 days', () => {
    expect(deadlineAt(AFTERNOON)).toBe(AFTERNOON + 7 * 24 * HOUR);
    expect(isExpired(AFTERNOON, AFTERNOON + 7 * 24 * HOUR)).toBe(false);
    expect(isExpired(AFTERNOON, AFTERNOON + 7 * 24 * HOUR + 1)).toBe(true);
  });
});

describe('AI can only slow down', () => {
  it('ignores faster or higher suggestions', () => {
    const out = applyAiSuggestion(DEFAULT_SAFETY, { gapSec: 5, hourlyCap: 9999, dailyCap: 9999, breakAfterMin: 90, breakMin: 1 });
    expect(out).toEqual(DEFAULT_SAFETY);
  });
  it('accepts slower suggestions', () => {
    const out = applyAiSuggestion(DEFAULT_SAFETY, { gapSec: 60, hourlyCap: 50, dailyCap: 400, breakAfterMin: 15, breakMin: 10 });
    expect(out).toMatchObject({ gapSec: 60, hourlyCap: 50, dailyCap: 400, breakAfterMin: 15, breakMin: 10 });
  });
});
