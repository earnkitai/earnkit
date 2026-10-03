import { createHash } from 'node:crypto';
import type { ReportedRepo } from './match';
import { sql } from './db';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Records the installation for a newly issued token. Idempotent for replays. */
export async function saveInstallation(token: string) {
  await sql()`INSERT INTO installations (token_hash) VALUES (${hash(token)}) ON CONFLICT (token_hash) DO NOTHING`;
}

export type Memory = {
  /** When this installation last listed programs (null the first time). */
  lastCheck: Date | null;
  github_user: string | null;
  repos: string[] | null;
  local_repos: ReportedRepo[] | null;
  working_on: string[];
};

/**
 * Starts a list_programs check: records now as the check time, saves the GitHub user/repos when
 * given, and returns what the installation had before (so later calls can omit them).
 */
export async function checkPrograms(
  installationId: number,
  given: {
    github_user?: string;
    repos?: string[];
    local_repos?: ReportedRepo[];
  } = {},
): Promise<Memory> {
  const db = sql();
  const saving = Boolean(given.github_user || given.repos?.length);
  const savingLocal = Boolean(given.local_repos?.length);
  const [row] = await db<
    {
      prev: Date | null;
      github_user: string | null;
      repos: string[] | null;
      local_repos: ReportedRepo[] | null;
      working_on: string[];
    }[]
  >`
    UPDATE installations i SET programs_checked_at = now(),
      local_repos = CASE WHEN ${savingLocal} THEN ${savingLocal ? db.json(given.local_repos!) : null} ELSE i.local_repos END,
      github_user = CASE WHEN ${saving} THEN ${given.github_user ?? null} ELSE i.github_user END,
      repos = CASE WHEN ${saving} THEN ${given.repos?.length ? given.repos : null}::text[] ELSE i.repos END
    FROM (SELECT id, programs_checked_at AS prev FROM installations WHERE id = ${installationId}) o
    WHERE i.id = o.id RETURNING o.prev, i.github_user, i.repos, i.local_repos, i.working_on`;
  return {
    lastCheck: row?.prev ?? null,
    github_user: row?.github_user ?? null,
    repos: row?.repos ?? null,
    local_repos: row?.local_repos ?? null,
    working_on: row?.working_on ?? [],
  };
}

/** Marks a program as being prepared by this installation (true) or done with (false). */
export async function setWorkingOn(
  installationId: number,
  programId: string,
  on: boolean,
) {
  await sql()`
    UPDATE installations SET working_on = CASE WHEN ${on}
      THEN array_append(array_remove(working_on, ${programId}), ${programId})
      ELSE array_remove(working_on, ${programId}) END
    WHERE id = ${installationId}`;
}

/** The installation's id for this token (and marks it as seen), or null if unknown. */
export async function touchInstallation(token: string) {
  const [row] = await sql()<{ id: number }[]>`
    UPDATE installations SET last_seen_at = now()
    WHERE token_hash = ${hash(token)} RETURNING id`;
  return row?.id ?? null;
}

/** The payout wallet of this installation's last campaign entry (lowercase), or null. */
export async function rememberedPayoutWallet(installationId: number) {
  const [row] = await sql()<{ payout_wallet: string | null }[]>`
    SELECT payout_wallet FROM installations WHERE id = ${installationId}`;
  return row?.payout_wallet ?? null;
}
