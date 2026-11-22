import { canSend, canDmPerson, deadlineAt, emptyState, recordSend, type SafetyConfig, type SendState } from './safety.js';
import { pickNext, type Job } from './scheduler.js';

export interface QJob extends Job {
  userId: string;
  status: 'queued' | 'sent' | 'expired' | 'skipped' | 'failed';
  skipReason?: string;
}
export type SendResult = { ok: true } | { ok: false; error: string };
export type Step =
  | { kind: 'sent'; job: QJob }
  | { kind: 'failed'; job: QJob; error: string }
  | { kind: 'wait'; retryAt: number; reason: string }
  | { kind: 'paused'; reason: string }
  | { kind: 'idle' };

const FAIL_WINDOW = 20;
const FAIL_LIMIT = 3; // 15% of 20

/** One account's queue: the same decisions the real bot will make (used by dry-run too). */
export class AccountQueue {
  state: SendState = emptyState();
  queued: QJob[] = [];
  all: QJob[] = [];
  paused: string | null = null;
  private lastReel: string | null = null;
  private lastDm = new Map<string, number>();
  private optedOut = new Set<string>();
  private recent: boolean[] = [];

  constructor(private cfg: SafetyConfig, private rand: () => number) {}

  seed(lastDm: Map<string, number>, lastReel: string | null, optedOut: string[]): void {
    this.lastDm = lastDm;
    this.lastReel = lastReel;
    for (const u of optedOut) this.optedOut.add(u);
  }

  optOut(userId: string): void {
    this.optedOut.add(userId);
  }

  enqueue(id: string, reelId: string, userId: string, commentAt: number): QJob {
    const job: QJob = { id, reelId, userId, commentAt, deadlineAt: deadlineAt(commentAt), status: 'queued' };
    this.queued.push(job);
    this.all.push(job);
    return job;
  }

  private expire(now: number): void {
    if (this.queued.length === 0 || now <= this.queued[0]!.deadlineAt) return;
    for (const j of this.queued) if (now > j.deadlineAt) j.status = 'expired';
    this.queued = this.queued.filter((j) => j.status === 'queued');
  }

  private take(job: QJob): void {
    this.queued = this.queued.filter((j) => j !== job);
  }

  step(now: number, send: (job: QJob) => SendResult): Step {
    if (this.paused) return { kind: 'paused', reason: this.paused };
    for (;;) {
      this.expire(now);
      if (this.queued.length === 0) return { kind: 'idle' };
      const d = canSend(this.state, this.cfg, now);
      if (!d.ok) return { kind: 'wait', retryAt: d.retryAt, reason: d.reason };
      const job = pickNext(this.queued, this.lastReel);
      if (!job) return { kind: 'idle' };
      const q = job as QJob;
      if (this.optedOut.has(q.userId) || !canDmPerson(this.lastDm.get(q.userId) ?? null, now)) {
        q.status = 'skipped';
        q.skipReason = this.optedOut.has(q.userId) ? 'opted_out' : 'person_limit';
        this.take(q);
        continue;
      }
      const res = send(q);
      this.take(q);
      this.lastReel = q.reelId;
      if (res.ok || res.error !== 'COMPOSE_FAILED') this.recent = [...this.recent.slice(-(FAIL_WINDOW - 1)), res.ok];
      if (res.ok) {
        q.status = 'sent';
        this.state = recordSend(this.state, this.cfg, now, this.rand);
        this.lastDm.set(q.userId, now);
        return { kind: 'sent', job: q };
      }
      q.status = 'failed';
      const fails = this.recent.filter((x) => !x).length;
      if (res.error === 'RATE_LIMIT' || fails >= FAIL_LIMIT) this.paused = `circuit_breaker:${res.error}`;
      return { kind: 'failed', job: q, error: res.error };
    }
  }
}

/** In-memory stand-in for Meta's private-reply endpoint with Meta's real rules. */
export class FakeMeta {
  replied = new Set<string>();
  sends: { commentId: string; at: number }[] = [];
  errors: string[] = [];
  constructor(private commentAt: Map<string, number>, private perHour = 750) {}

  sendPrivateReply(commentId: string, now: number): SendResult {
    const at = this.commentAt.get(commentId);
    const fail = (error: string): SendResult => {
      this.errors.push(error);
      return { ok: false, error };
    };
    if (at === undefined) return fail('UNKNOWN_COMMENT');
    if (this.replied.has(commentId)) return fail('ALREADY_REPLIED');
    if (now > deadlineAt(at)) return fail('WINDOW_EXPIRED');
    if (this.sends.filter((s) => s.at > now - 3_600_000).length >= this.perHour) return fail('RATE_LIMIT');
    this.replied.add(commentId);
    this.sends.push({ commentId, at: now });
    return { ok: true };
  }
}
