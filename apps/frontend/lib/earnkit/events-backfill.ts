import { sql, type Db } from './db';
import { siteUrl } from './entry-text';
import { eventLogEnabled, eventRepoKey, recordEvent, type BuilderEvent } from './events';
import { loginBasisFor, type LoginProof } from './github-verify';
import { siteLink } from './hosting';
import { sharedGroup } from './installations';
import { outcomeEventType, type OUTCOME_RESULTS } from './outcomes';

/**
 * v2.11 T3 (spec 6, "Backfill"): writes the builder events that happened before the log was on,
 * from contract_deploys, host_deploys, projects, submissions and entry_outcomes. Each event takes its
 * source row's own time as `at`, and the same dedupe_key the live step uses, so a rerun (or a step
 * that already wrote its event) writes nothing twice. Only what was proven or given is recorded:
 * the login through loginBasisFor, the wallet only when the builder gave it. Backfilled rows carry
 * `detail.backfill = true`.
 *
 * Owner-run only (scripts/events-backfill.mts): never from predeploy or the cron. Writes nothing
 * unless EARNKIT_EVENT_LOG=on.
 */

export type BackfillCounts = Record<'deployed' | 'hosted' | 'entered' | 'submitted' | 'outcomes', { seen: number; written: number }>;

const PAGE = 500;

/** Rows of `query(after)` page by page (ordered by `id`), until a short page. */
async function* pages<T extends { id: number }>(query: (after: number) => Promise<T[]>): AsyncGenerator<T> {
  for (let after = 0; ; ) {
    const rows = await query(after);
    for (const r of rows) yield r;
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1].id;
  }
}

const who = (p: LoginProof | null) => (p ? { github_login: p.login, login_basis: p.basis } : {});

/** The proven login for an entry's step (null without an installation or a repo). */
async function entryLogin(installationId: number | null, repoKey: string | undefined, projectId: number) {
  return installationId !== null && repoKey ? loginBasisFor(installationId, repoKey, { projectId }) : null;
}

/** `installationIds`: only these installations' rows (tests; a host deploy by its site's installation). */
export async function backfillEvents(db: Db = sql(), o: { installationIds?: number[] } = {}): Promise<BackfillCounts> {
  const scope = (col: string) => (o.installationIds ? db`AND ${db(col)} = ANY(${o.installationIds}::int[])` : db``);
  const counts: BackfillCounts = {
    deployed: { seen: 0, written: 0 },
    hosted: { seen: 0, written: 0 },
    entered: { seen: 0, written: 0 },
    submitted: { seen: 0, written: 0 },
    outcomes: { seen: 0, written: 0 },
  };
  if (!eventLogEnabled()) return counts;
  const write = async (k: keyof BackfillCounts, e: BuilderEvent) => {
    counts[k].seen++;
    if (await recordEvent(e, db)) counts[k].written++;
  };

  // deployed: every contract the deploy step settled as deployed (the runbook's too, plan 3.2).
  type Deploy = { id: number; installation_id: number; login: string | null; repo_key: string; chain: string; tx_hash: string; address: string | null; owner_ok: boolean | null; created_at: Date };
  for await (const d of pages((after) => db<Deploy[]>`
      SELECT id, installation_id, login, repo_key, chain, tx_hash, address, owner_ok, created_at FROM contract_deploys
      WHERE status = 'deployed' AND id > ${after} ${scope('installation_id')} ORDER BY id LIMIT ${PAGE}`)) {
    const shared = await sharedGroup(d.installation_id).catch(() => true);
    const proof = await loginBasisFor(d.installation_id, d.repo_key, shared ? { callerLogin: d.login } : { proofLine: true });
    await write('deployed', {
      type: 'deployed',
      dedupe_key: `deployed:${d.id}`,
      at: d.created_at,
      installation_id: d.installation_id,
      repo_key: d.repo_key,
      chain: d.chain,
      ...(d.tx_hash && { proof_tx: d.tx_hash }),
      ...who(proof),
      detail: { ...(d.address && { address: d.address }), owner_ok: d.owner_ok, backfill: true },
    });
  }

  // hosted: every upload that went live (the host gate is a GitHub sign-in, so its login is signin).
  type Host = { id: number; login: string; slug: string; repo_key: string | null; at: Date; installation_id: number | null };
  for await (const h of pages((after) => db<Host[]>`
      SELECT d.id, d.login, d.slug, d.repo_key, COALESCE(d.done_at, d.at) AS at, s.installation_id
      FROM host_deploys d LEFT JOIN hosted_sites s ON s.slug = d.slug AND s.repo_key = d.repo_key
      WHERE d.status = 'live' AND d.id > ${after} ${scope('s.installation_id')} ORDER BY d.id LIMIT ${PAGE}`)) {
    await write('hosted', {
      type: 'hosted',
      dedupe_key: `hosted:${h.id}`,
      at: h.at,
      github_login: h.login,
      login_basis: 'signin',
      ...(h.installation_id !== null && { installation_id: h.installation_id }),
      ...(h.repo_key && { repo_key: h.repo_key }),
      proof_url: siteLink(h.slug),
      detail: { host: 'earnkit', slug: h.slug, backfill: true },
    });
  }

  // entered: every entry row; submitted: every entry record_submission recorded (a submissions row).
  type Entry = {
    id: number; installation_id: number | null; program_id: string; repo_url: string | null; wallet: string | null; submitted_at: Date;
    first_submission_at: Date | null; submission_url: string | null;
  };
  for await (const p of pages((after) => db<Entry[]>`
      SELECT p.id, p.installation_id, p.program_id, p.repo_url, COALESCE(p.payout_wallet, p.creator_wallet) AS wallet, p.submitted_at,
        (SELECT min(s.created_at) FROM submissions s WHERE s.project_id = p.id) AS first_submission_at,
        (SELECT s.external_submission_url FROM submissions s WHERE s.project_id = p.id AND s.external_submission_url IS NOT NULL
          ORDER BY s.id LIMIT 1) AS submission_url
      FROM projects p WHERE p.id > ${after} ${scope('p.installation_id')} ORDER BY p.id LIMIT ${PAGE}`)) {
    const repoKey = eventRepoKey(p.repo_url);
    const proof = await entryLogin(p.installation_id, repoKey, p.id);
    const base = {
      ...(p.installation_id !== null && { installation_id: p.installation_id }),
      program_id: p.program_id,
      project_id: p.id,
      ...(repoKey && { repo_key: repoKey }),
      ...who(proof),
    };
    await write('entered', {
      type: 'entered',
      dedupe_key: `entered:${p.id}`,
      at: p.submitted_at,
      ...base,
      ...(p.wallet && { wallet: p.wallet }),
      proof_url: `${siteUrl()}/p/${p.id}`,
      detail: { backfill: true },
    });
    if (p.first_submission_at)
      await write('submitted', {
        type: 'submitted',
        dedupe_key: `submitted:${p.id}`,
        at: p.first_submission_at,
        ...base,
        ...(p.submission_url && { proof_url: p.submission_url }),
        detail: { basis: p.submission_url ? 'link' : 'recorded', backfill: true },
      });
  }

  // won and lost: every outcome but unknown (self-reports keep their basis and never count).
  type Outcome = {
    id: number; project_id: number; program_id: string; round_label: string; result: (typeof OUTCOME_RESULTS)[number];
    prize_usd: string | null; source_url: string | null; captured_at: Date; basis: 'announcement' | 'self_reported';
    installation_id: number | null; repo_url: string | null;
  };
  for await (const o of pages((after) => db<Outcome[]>`
      SELECT eo.id, eo.project_id, eo.program_id, eo.round_label, eo.result, eo.prize_usd::text, eo.source_url, eo.captured_at, eo.basis,
        p.installation_id, p.repo_url
      FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id
      WHERE eo.result <> 'unknown' AND eo.id > ${after} ${scope('p.installation_id')} ORDER BY eo.id LIMIT ${PAGE}`)) {
    const type = outcomeEventType(o.result);
    if (!type) continue;
    const repoKey = eventRepoKey(o.repo_url);
    await write('outcomes', {
      type,
      dedupe_key: `outcome:${o.project_id}:${o.round_label}:${o.basis}`,
      at: o.captured_at,
      ...(o.installation_id !== null && { installation_id: o.installation_id }),
      program_id: o.program_id,
      project_id: o.project_id,
      ...(repoKey && { repo_key: repoKey }),
      ...who(await entryLogin(o.installation_id, repoKey, o.project_id)),
      ...(o.source_url && { proof_url: o.source_url }),
      detail: { basis: o.basis, result: o.result, round: o.round_label, ...(o.prize_usd !== null && { prize_usd: Number(o.prize_usd) }), backfill: true },
    });
  }
  return counts;
}
