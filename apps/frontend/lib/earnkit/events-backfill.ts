import { sql, type Db } from './db';
import { siteUrl } from './entry-text';
import { eventLogEnabled, eventRepoKey, proofLink, recordEvent, type BuilderEvent } from './events';
import { loginBasisFor, type LoginProof } from './github-verify';
import { siteLink } from './hosting';
import { sharedGroup, type StoredBuild } from './installations';
import { outcomeEventType, type OUTCOME_RESULTS } from './outcomes';
import { pagesLinkOf } from './pages-link';

/**
 * v2.11 T3 (spec 6, "Backfill"): writes the builder events that happened before the log was on,
 * from installations.build, contract_deploys, host_deploys, projects, submissions and entry_outcomes. Each event takes its
 * source row's own time as `at`, and the same dedupe_key the live step uses, so a rerun (or a step
 * that already wrote its event) writes nothing twice. Only what was proven or given is recorded:
 * the login through loginBasisFor, the wallet only when the builder gave it. Backfilled rows carry
 * `detail.backfill = true`.
 *
 * Owner-run only (scripts/events-backfill.mts): never from predeploy or the cron. Writes nothing
 * unless EARNKIT_EVENT_LOG=on.
 */

export type BackfillCounts = Record<'built' | 'deployed' | 'hosted' | 'entered' | 'submitted' | 'outcomes', { seen: number; written: number }>;

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
    built: { seen: 0, written: 0 },
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

  // built (final fix I1): the build path's build (installations.build, never on a shared client) whose
  // repo got a contract_deploys row from this installation: the live step writes `built` just before
  // that send. Its time is the first such row's (reserved right after the event); the login is the
  // one proven for that row (its line_owner, else a sign-in or App proof), never guessed.
  type Built = { id: number; build: StoredBuild };
  for await (const i of pages((after) => db<Built[]>`
      SELECT id, build FROM installations
      WHERE build ? 'repo_url' AND id > ${after} ${scope('id')} ORDER BY id LIMIT ${PAGE}`)) {
    const b = i.build;
    const repoKey = eventRepoKey(b.repo_url);
    if (!repoKey || !b.program_id || !b.wallet || !b.started_at) continue;
    // Security re-review 4 F5: only a deploy this build itself sent: its starter's exact bytecode
    // (contract_deploys.starter) for the build's wallet, made after the build started, never reverted.
    const [first] = await db<{ created_at: Date; line_owner: string | null }[]>`
      SELECT created_at, line_owner FROM contract_deploys
      WHERE installation_id = ${i.id} AND repo_key = ${repoKey} AND starter = ${b.starter_id} AND owner_wallet = ${b.wallet.toLowerCase()}
        AND created_at >= ${new Date(b.started_at)} AND status <> 'reverted'
      ORDER BY id LIMIT 1`;
    if (!first || (await sharedGroup(i.id).catch(() => true))) continue;
    await write('built', {
      type: 'built',
      dedupe_key: `built:${i.id}:${repoKey}:${b.program_id}`,
      at: first.created_at,
      installation_id: i.id,
      repo_key: repoKey,
      program_id: b.program_id,
      ...(b.wallet && { wallet: b.wallet }),
      proof_url: `https://github.com/${repoKey}`,
      ...who(await loginBasisFor(i.id, repoKey)),
      detail: { starter: b.starter_id, ...(b.twist && { twist: b.twist }), backfill: true },
    });
  }

  // deployed: every contract the deploy step settled as deployed (the runbook's too, plan 3.2).
  // The owner wallet and block are kept from v2.11 on; older rows have neither. No RPC read here (the
  // backfill stays offline and free): T11's usage check reads a missing block from the receipt.
  type Deploy = {
    id: number; installation_id: number; login: string | null; repo_key: string; chain: string; tx_hash: string; address: string | null;
    owner_ok: boolean | null; created_at: Date; owner_wallet: string | null; block: string | null; code_differs: boolean;
  };
  for await (const d of pages((after) => db<Deploy[]>`
      SELECT id, installation_id, login, repo_key, chain, tx_hash, address, owner_ok, created_at, owner_wallet, block::text, code_differs FROM contract_deploys
      WHERE status = 'deployed' AND id > ${after} ${scope('installation_id')} ORDER BY id LIMIT ${PAGE}`)) {
    const shared = await sharedGroup(d.installation_id).catch(() => true);
    const proof = await loginBasisFor(d.installation_id, d.repo_key, shared ? { callerLogin: d.login } : {});
    await write('deployed', {
      type: 'deployed',
      dedupe_key: `deployed:${d.id}`,
      at: d.created_at,
      installation_id: d.installation_id,
      repo_key: d.repo_key,
      chain: d.chain,
      ...(d.tx_hash && { proof_tx: d.tx_hash }),
      ...(d.owner_wallet && { wallet: d.owner_wallet }),
      ...who(proof),
      detail: { ...(d.address && { address: d.address }), owner_ok: d.owner_ok, ...(d.block !== null && { block: Number(d.block) }),
        ...(d.code_differs && { code_differs: true }),
        backfill: true,
      },
    });
  }

  // hosted: every upload that went live, with the way its login was proven (final fix M1: since T9 a
  // proof-line upload is `proof_line`, not a sign-in).
  type Host = { id: number; login: string; slug: string; repo_key: string | null; at: Date; installation_id: number | null; basis: 'signin' | 'app' | 'proof_line' };
  for await (const h of pages((after) => db<Host[]>`
      SELECT d.id, d.login, d.slug, d.repo_key, COALESCE(d.done_at, d.at) AS at, s.installation_id, d.basis
      FROM host_deploys d LEFT JOIN hosted_sites s ON s.slug = d.slug AND s.repo_key = d.repo_key
      WHERE d.status = 'live' AND d.id > ${after} ${scope('s.installation_id')} ORDER BY d.id LIMIT ${PAGE}`)) {
    await write('hosted', {
      type: 'hosted',
      dedupe_key: `hosted:${h.id}`,
      at: h.at,
      github_login: h.login,
      login_basis: h.basis,
      ...(h.installation_id !== null && { installation_id: h.installation_id }),
      ...(h.repo_key && { repo_key: h.repo_key }),
      proof_url: siteLink(h.slug),
      detail: { host: 'earnkit', slug: h.slug, backfill: true },
    });
  }

  // hosted on GitHub Pages (final fix I1): an entry whose live link is its repo's own Pages link
  // (pagesLinkOf), with a contract EarnKit deployed for that installation and repo, under the live
  // step's key. Offline: no probe (`detail.probe: false`); its time is the entry's, the first record
  // of the link (the live step writes it on the call just before).
  type Pages = { id: number; installation_id: number; repo_url: string; live_url: string; program_id: string; submitted_at: Date };
  for await (const p of pages((after) => db<Pages[]>`
      SELECT p.id, p.installation_id, p.repo_url, p.live_url, p.program_id, p.submitted_at FROM projects p
      WHERE p.installation_id IS NOT NULL AND p.repo_url IS NOT NULL AND p.live_url ILIKE '%.github.io%'
        AND p.id > ${after} ${scope('p.installation_id')} ORDER BY p.id LIMIT ${PAGE}`)) {
    const repoKey = eventRepoKey(p.repo_url);
    const link = repoKey ? pagesLinkOf(repoKey, p.live_url) : null;
    if (!repoKey || !link) continue;
    const [deployed] = await db`
      SELECT 1 FROM contract_deploys WHERE installation_id = ${p.installation_id} AND repo_key = ${repoKey} AND status = 'deployed' LIMIT 1`;
    if (!deployed || (await sharedGroup(p.installation_id).catch(() => true))) continue;
    await write('hosted', {
      type: 'hosted',
      dedupe_key: `hosted:gh:${p.installation_id}:${repoKey}:${link}`,
      at: p.submitted_at,
      installation_id: p.installation_id,
      repo_key: repoKey,
      program_id: p.program_id,
      proof_url: link,
      ...who(await loginBasisFor(p.installation_id, repoKey)),
      detail: { host: 'github_pages', probe: false, backfill: true },
    });
  }

  // entered: every entry row; submitted: every entry record_submission recorded (a submissions row).
  type Entry = {
    id: number; installation_id: number | null; program_id: string; repo_url: string | null; wallet: string | null; submitted_at: Date;
    first_submission_at: Date | null; submission_url: string | null;
  };
  for await (const p of pages((after) => db<Entry[]>`
      SELECT p.id, p.installation_id, p.program_id, p.repo_url, p.payout_wallet AS wallet, p.submitted_at,
        s.first_submission_at, s.submission_url
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT min(created_at) AS first_submission_at,
          (array_agg(external_submission_url ORDER BY id) FILTER (WHERE external_submission_url IS NOT NULL))[1] AS submission_url
        FROM submissions WHERE project_id = p.id) s ON true
      WHERE p.id > ${after} ${scope('p.installation_id')} ORDER BY p.id LIMIT ${PAGE}`)) {
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
        ...(proofLink(p.submission_url) && { proof_url: proofLink(p.submission_url) }),
        detail: { basis: proofLink(p.submission_url) ? 'link' : 'recorded', backfill: true },
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
