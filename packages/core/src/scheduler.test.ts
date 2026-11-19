import { describe, it, expect } from 'vitest';
import { DEFAULT_SAFETY, canSend, emptyState, recordSend } from './safety.js';
import { forecastDays, pickNext, sendsPerDay, sendsPerHour, splitExpired, willMissDeadline, type Job } from './scheduler.js';

const T0 = Date.UTC(2026, 10, 19, 10, 0);
const DAY = 86_400_000;
const job = (id: string, reelId: string, deadlineAt: number): Job => ({ id, reelId, commentAt: deadlineAt - 7 * DAY, deadlineAt });

describe('fair scheduler', () => {
  it('round-robins across reels so a viral reel cannot starve others', () => {
    let queue: Job[] = [];
    for (let i = 0; i < 100; i++) queue.push(job(`a${i}`, 'reelA', T0 + DAY + i));
    for (let i = 0; i < 10; i++) queue.push(job(`b${i}`, 'reelB', T0 + DAY + i));
    for (let i = 0; i < 10; i++) queue.push(job(`c${i}`, 'reelC', T0 + DAY + i));
    const order: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 9; i++) {
      const j: Job = pickNext(queue, last)!;
      order.push(j.reelId);
      last = j.reelId;
      queue = queue.filter((q) => q.id !== j.id);
    }
    expect(order).toEqual(['reelA', 'reelB', 'reelC', 'reelA', 'reelB', 'reelC', 'reelA', 'reelB', 'reelC']);
  });
  it('picks the nearest deadline first inside a reel', () => {
    const q = [job('late', 'r', T0 + 5 * DAY), job('soon', 'r', T0 + DAY), job('mid', 'r', T0 + 3 * DAY)];
    expect(pickNext(q, null)!.id).toBe('soon');
  });
  it('returns null on an empty queue', () => {
    expect(pickNext([], null)).toBeNull();
  });
  it('moves jobs older than 7 days to expired', () => {
    const { live, expired } = splitExpired([job('ok', 'r', T0 + 1), job('old', 'r', T0 - 1)], T0);
    expect(live.map((j) => j.id)).toEqual(['ok']);
    expect(expired.map((j) => j.id)).toEqual(['old']);
  });
});

describe('backlog forecast', () => {
  it('default speed is capped by hourly and daily limits', () => {
    expect(sendsPerHour()).toBe(120);
    expect(sendsPerDay()).toBe(1500);
  });
  it('5000 comments take about 3.3 days and finish inside 7 days', () => {
    expect(forecastDays(5000)).toBeCloseTo(3.33, 1);
    expect(willMissDeadline(5000, DEFAULT_SAFETY, T0 + 7 * DAY, T0)).toBe(false);
  });
  it('20000 comments will miss the 7 day limit', () => {
    expect(willMissDeadline(20000, DEFAULT_SAFETY, T0 + 7 * DAY, T0)).toBe(true);
  });
});

describe('spike does not raise speed', () => {
  it('5000 queued comments still send at most the hourly cap in one hour', () => {
    let st = emptyState();
    let sent = 0;
    for (let t = T0; t < T0 + 3_600_000; t += 1000) {
      if (canSend(st, DEFAULT_SAFETY, t).ok) {
        st = recordSend(st, DEFAULT_SAFETY, t, () => 0.5);
        sent++;
      }
    }
    expect(sent).toBeLessThanOrEqual(DEFAULT_SAFETY.hourlyCap);
    expect(sent).toBeGreaterThan(0);
  });
});
