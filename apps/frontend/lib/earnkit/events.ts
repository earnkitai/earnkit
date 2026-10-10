import { z } from 'zod';
import { sql, type Db } from './db';

/**
 * v2.11 spec 6: the builder event log. Append-only (a trigger refuses UPDATE, DELETE and TRUNCATE;
 * see db/schema.sql), idempotent by dedupe_key, and never in the way: a failed write is logged by
 * error class only and the builder's step goes on.
 *
 * Off until EARNKIT_EVENT_LOG=on. The owner turns it on only after the /terms "What EarnKit
 * records" section is live (v2.11 T12), so no row is written in production before it is disclosed.
 */
export const EVENT_LOG_FLAG = 'EARNKIT_EVENT_LOG';
export const eventLogEnabled = () => process.env[EVENT_LOG_FLAG] === 'on';

export const EVENT_TYPES = ['built', 'deployed', 'hosted', 'entered', 'submitted', 'won', 'lost', 'usage_check'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const LOGIN_BASES = ['signin', 'app', 'proof_line', 'repo_owner'] as const;
export type LoginBasis = (typeof LOGIN_BASES)[number];

/** detail over this many bytes of JSON is stored as { truncated: true }. */
export const DETAIL_MAX_BYTES = 2048;

const text = (max: number) => z.string().min(1).max(max);
const Event = z.strictObject({
  type: z.enum(EVENT_TYPES),
  dedupe_key: text(300),
  github_login: text(100).optional(),
  login_basis: z.enum(LOGIN_BASES).optional(),
  installation_id: z.number().int().optional(),
  wallet: text(100).optional(),
  repo_key: text(300).optional(),
  program_id: text(200).optional(),
  project_id: z.number().int().optional(),
  chain: text(50).optional(),
  proof_tx: text(200).optional(),
  proof_url: text(2048).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type BuilderEvent = z.infer<typeof Event>;

const errName = (err: unknown) => (err instanceof Error ? err.name : 'error');

/** Writes one event. True when a row was written; false when off, a duplicate, invalid or failed. */
export async function recordEvent(e: BuilderEvent, db?: Db): Promise<boolean> {
  if (!eventLogEnabled()) return false;
  const parsed = Event.safeParse(e);
  if (!parsed.success) {
    const type = EVENT_TYPES.includes(e?.type as EventType) ? e.type : 'invalid';
    console.error(`[events] ${type} ZodError`);
    return false;
  }
  const v = parsed.data;
  let detail: Record<string, unknown> = v.detail ?? {};
  try {
    if (Buffer.byteLength(JSON.stringify(detail), 'utf8') > DETAIL_MAX_BYTES) detail = { truncated: true };
  } catch {
    detail = { truncated: true }; // not serializable (a cycle or a bigint)
  }
  const low = (s: string | undefined) => (s === undefined ? null : s.toLowerCase());
  try {
    const q = db ?? sql();
    const rows = await q`
      INSERT INTO builder_events (type, github_login, login_basis, installation_id, wallet, repo_key, program_id,
        project_id, chain, proof_tx, proof_url, detail, dedupe_key)
      VALUES (${v.type}, ${low(v.github_login)}, ${v.login_basis ?? null}, ${v.installation_id ?? null}, ${low(v.wallet)},
        ${low(v.repo_key)}, ${v.program_id ?? null}, ${v.project_id ?? null}, ${v.chain ?? null}, ${v.proof_tx ?? null},
        ${v.proof_url ?? null}, ${q.json(detail as Parameters<typeof q.json>[0])}, ${v.dedupe_key})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id`;
    return rows.length === 1;
  } catch (err) {
    console.error(`[events] ${v.type} ${errName(err)}`);
    return false;
  }
}
