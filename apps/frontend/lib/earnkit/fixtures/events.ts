import { sql, type Db } from '../db';
import { EVENT_LOG_FLAG, eventDbForTests } from '../events';

/** v2.11 T3 tests: runs `fn` with the event log on (the test guard turns it off), then restores the flag. */
export async function withEventLog<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env[EVENT_LOG_FLAG];
  process.env[EVENT_LOG_FLAG] = 'on';
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[EVENT_LOG_FLAG];
    else process.env[EVENT_LOG_FLAG] = before;
  }
}

/** Runs `fn` with every event write failing like a dead pool (plan 3.6); the log is on. */
export async function withFailingEventLog<T>(fn: () => Promise<T>): Promise<T> {
  const db = Object.assign(
    () => {
      const err = new Error('connection terminated');
      err.name = 'PostgresError';
      return Promise.reject(err);
    },
    { json: (v: unknown) => v },
  ) as unknown as Db;
  eventDbForTests(db);
  try {
    return await withEventLog(fn);
  } finally {
    eventDbForTests(null);
  }
}

export type EventRow = {
  id: string;
  at: Date;
  type: string;
  github_login: string | null;
  login_basis: string | null;
  installation_id: number | null;
  wallet: string | null;
  repo_key: string | null;
  program_id: string | null;
  project_id: number | null;
  chain: string | null;
  proof_tx: string | null;
  proof_url: string | null;
  detail: Record<string, unknown>;
  dedupe_key: string;
};

/** The events with these dedupe keys, in id order. */
export const eventsByKey = async (...keys: string[]) => [
  ...(await sql()<EventRow[]>`SELECT * FROM builder_events WHERE dedupe_key = ANY(${keys}::text[]) ORDER BY id`),
];

/** The events of one installation, in id order. */
export const eventsOfInstallation = async (installationId: number) => [
  ...(await sql()<EventRow[]>`SELECT * FROM builder_events WHERE installation_id = ${installationId} ORDER BY id`),
];

/** Captures console.error lines while fn runs. */
export async function errorLines(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return lines;
}
