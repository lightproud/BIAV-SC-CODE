/**
 * Small async primitives extracted from query.ts (audit 2026-07-10 P2-3):
 * a settle-once deferred and the push-based queue feeding user turns into
 * the run loop. Pure, dependency-free, unit-testable outside the 2000-line
 * orchestration file.
 */

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  settled: boolean;
};

export function createDeferred<T>(): Deferred<T> {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  // Pre-attach a handler so a rejection nobody awaits never becomes an
  // unhandledRejection; callers of initializationResult() still see it.
  void promise.catch(() => undefined);
  const d: Deferred<T> = {
    promise,
    settled: false,
    resolve: (v) => {
      if (d.settled) return;
      d.settled = true;
      resolveFn(v);
    },
    reject: (e) => {
      if (d.settled) return;
      d.settled = true;
      rejectFn(e);
    },
  };
  return d;
}

/** Minimal push-based async queue feeding user turns into the run loop. */
export class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<{
    resolve: (r: IteratorResult<T, undefined>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private closed = false;
  private failure: { err: unknown } | null = null;

  /** Returns false when the queue is already closed/failed. */
  push(item: T): boolean {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter.resolve({ done: false, value: item });
    else this.items.push(item);
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) {
      w.resolve({ done: true, value: undefined });
    }
  }

  fail(err: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = { err };
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  isClosed(): boolean {
    return this.closed;
  }

  /** Snapshot of items pushed but not yet consumed (L2-5: interrupt() reports
   *  these as still queued instead of hardcoding an empty receipt). */
  pending(): readonly T[] {
    return [...this.items];
  }

  async next(): Promise<IteratorResult<T, undefined>> {
    // Gate on queue LENGTH, not on `shift() !== undefined`: a legitimately
    // enqueued `undefined` value is indistinguishable from an empty queue under
    // the shift-sentinel form, so a buffered `undefined` turn would be swallowed
    // and the consumer would stall (latent — only SDKUserMessage instances are
    // pushed today, never undefined; audit 2026-07-17 P3).
    if (this.items.length > 0) {
      return { done: false, value: this.items.shift() as T };
    }
    if (this.failure !== null) throw this.failure.err;
    if (this.closed) return { done: true, value: undefined };
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
