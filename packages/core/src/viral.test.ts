import { describe, it, expect } from 'vitest';
import { DEFAULT_SAFETY } from './safety.js';
import { AccountQueue, FakeMeta } from './sim.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 10, 23, 4, 30); // 10:00 IST

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function run(total: number, spreadMs: number, reels: number, dupEvery: number) {
  const rand = lcg(7);
  const commentAt = new Map<string, number>();
  const arrivals: { id: string; reel: string; user: string; at: number }[] = [];
  for (let i = 0; i < total; i++) {
    const id = `c${i}`;
    const at = START + Math.floor((i / total) * spreadMs);
    commentAt.set(id, at);
    // every dupEvery-th comment is a repeat commenter (same user as the previous one)
    const user = dupEvery > 0 && i % dupEvery === 1 ? `u${i - 1}` : `u${i}`;
    arrivals.push({ id, reel: `r${i % reels}`, user, at });
  }
  const q = new AccountQueue(DEFAULT_SAFETY, rand);
  const meta = new FakeMeta(commentAt);
  const sendTimes: number[] = [];
  const byReel: string[] = [];
  let now = START;
  let idx = 0;
  const end = START + 12 * DAY;
  while (now < end) {
    while (idx < arrivals.length && arrivals[idx]!.at <= now) {
      const a = arrivals[idx++]!;
      q.enqueue(a.id, a.reel, a.user, a.at);
    }
    const s = q.step(now, (job) => meta.sendPrivateReply(job.id, now));
    const nextArrival = idx < arrivals.length ? arrivals[idx]!.at : Infinity;
    if (s.kind === 'sent') {
      sendTimes.push(now);
      byReel.push(s.job.reelId);
      now += 1;
    } else if (s.kind === 'wait') now = Math.max(now + 1, Math.min(s.retryAt, nextArrival));
    else if (s.kind === 'idle') {
      if (nextArrival === Infinity) break;
      now = nextArrival;
    } else break;
  }
  return { q, meta, sendTimes, byReel };
}

function maxInWindow(times: number[], win: number): number {
  let max = 0;
  let lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi]! - times[lo]! >= win) lo++;
    max = Math.max(max, hi - lo + 1);
  }
  return max;
}

describe('viral reel: 5,000 comments in 1 hour', () => {
  const r = run(5000, HOUR, 3, 50);
  it('never breaks the 15s gap floor', () => {
    const gaps = r.sendTimes.slice(1).map((t, i) => t - r.sendTimes[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(15_000);
  });
  it('respects hourly and daily caps', () => {
    expect(maxInWindow(r.sendTimes, HOUR)).toBeLessThanOrEqual(DEFAULT_SAFETY.hourlyCap);
    expect(maxInWindow(r.sendTimes, DAY)).toBeLessThanOrEqual(DEFAULT_SAFETY.dailyCap);
  });
  it('never sends in quiet hours (01:00 to 06:00 IST)', () => {
    for (const t of r.sendTimes) {
      const h = new Date(t + 330 * 60_000).getUTCHours();
      expect(h >= 1 && h < 6).toBe(false);
    }
  });
  it('meta sees no error: no duplicate, no expired, no rate limit', () => {
    expect(r.meta.errors).toHaveLength(0);
  });
  it('sends one DM per person and skips repeat commenters', () => {
    const users = new Set(r.q.all.filter((j) => j.status === 'sent').map((j) => j.userId));
    expect(users.size).toBe(r.sendTimes.length);
    expect(r.q.all.filter((j) => j.skipReason === 'person_limit').length).toBeGreaterThan(0);
  });
  it('every comment is sent inside its 7 day deadline', () => {
    for (const j of r.q.all) if (j.status === 'sent') expect(r.meta.replied.has(j.id)).toBe(true);
    expect(r.q.all.filter((j) => j.status === 'expired')).toHaveLength(0);
  });
  it('shares the queue fairly across reels', () => {
    const first = r.byReel.slice(0, 300);
    for (const reel of ['r0', 'r1', 'r2']) expect(first.filter((x) => x === reel).length).toBeGreaterThanOrEqual(90);
  });
});

describe('overload: more comments than 7 days can carry', () => {
  const r = run(12000, HOUR, 3, 0);
  it('expires the leftovers instead of sending late', () => {
    expect(r.q.all.filter((j) => j.status === 'expired').length).toBeGreaterThan(0);
    expect(r.meta.errors).toHaveLength(0);
    expect(maxInWindow(r.sendTimes, DAY)).toBeLessThanOrEqual(DEFAULT_SAFETY.dailyCap);
  });
});

describe('circuit breaker', () => {
  it('pauses the account on a rate limit error', () => {
    const q = new AccountQueue(DEFAULT_SAFETY, () => 0.5);
    q.enqueue('a', 'r0', 'u1', START);
    q.enqueue('b', 'r0', 'u2', START);
    const s = q.step(START, () => ({ ok: false, error: 'RATE_LIMIT' }));
    expect(s.kind).toBe('failed');
    expect(q.step(START + 60_000, () => ({ ok: true })).kind).toBe('paused');
  });
});
