/**
 * v2.13.1 O5 N1 (controller ruling): under the Bench the first find answers in under 3 seconds whatever
 * the repo's size. Every GitHub read on the reply path (the refresh of the person's sources, matching the
 * one project) keeps running, but the reply waits for each at most
 * REPLY_WAIT_MS and then answers with what is already known; the slower read lands for the next reply
 * (or the hourly cron).
 */
export const REPLY_WAIT_MS = 1_500;

/**
 * Waits for `p` at most `ms`: its value when it settles in time, else `undefined` (it keeps running;
 * a later rejection is swallowed, as every caller here already logs its own errors).
 */
export async function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  const quiet = p.catch(() => undefined);
  try {
    return await Promise.race([quiet, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Thrown by inTime when the wait is over (the work keeps running; its later failure is swallowed). */
export class ReplyLate extends Error {
  constructor() {
    super('answered before this read');
    this.name = 'ReplyLate';
  }
}

/**
 * `p`'s value when it settles within `ms` (its own error when it fails in time), else ReplyLate. Pure
 * timing: `p` is never cancelled. `onLateError`: called once with a failure that comes after the wait.
 */
export async function inTime<T>(p: Promise<T>, ms: number, onLateError?: (err: unknown) => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // O5 fix round 1: a failure after the reply went out is reported once (it reaches no one else).
      p.catch((err: unknown) => onLateError?.(err));
      reject(new ReplyLate());
    }, Math.max(0, ms));
  });
  p.catch(() => undefined);
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}
