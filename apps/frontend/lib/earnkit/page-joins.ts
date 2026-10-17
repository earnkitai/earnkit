import { sql, type Db } from './db';
import { noteEvent } from './events';
import { profileChanged } from './profile-cache';

/**
 * v2.13.4 R6 and R7 (controller rulings, answering two security scans of the R1 one-click join).
 * - Every R1 join is a page_joins row: the page's root, the joining group's own former root, its members.
 * - PROBATION (R7): for 24 hours from joined_at a member may only post updates to the page, never over
 *   another installation's update for the same week. Every other write is refused with one line and one
 *   question (PROBATION_LINES); tools.ts, bench-find.ts and updates.ts ask onProbation.
 * - THE NOTICE (R6, I-1, I-2): each installation that was on the page before the join is asked, until it
 *   answers, "A new agent was added to your page on <date>. If that wasn't you, want me to remove it?"
 *   (pendingNotice). It lives on the join row (answers), never in the shared bench_ask. Only an eligible
 *   installation's yes or no counts (eligibleFor: on the page now, by join order before this join).
 * - DETACH: a yes moves the members back to their own former group and hides their updates since the
 *   join (with probation, nothing else they could do needs undoing); logged as page_detached.
 */
export const PROBATION_MS = 24 * 60 * 60_000;

/** The notice, the reply's one question. `date` as "Oct 17". Pure. */
export const joinNoticeLine = (date: Date) =>
  `A new agent was added to your page on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}. If that wasn't you, want me to remove it?`;
/** After an answer: one plain line, then one question (a yes calls find). */
export const DETACH_LINES = {
  done: 'Done. That agent is off your page, and its updates since it joined are hidden.',
  kept: 'Okay. It stays on your page.',
  none: 'Nothing to change: that agent is already off your page.',
  ask: 'Want me to show where you stand now?',
} as const;
export const DETACH_NOTE = "On a yes, call find. Don't show this note.";
/** R7: a write refused while on probation (one line, then one question whose yes is the week's update). */
export const PROBATION_LINES = {
  main: "This agent was just added to your page, so it can't change your project for a day.\nWant me to post this week's update instead?",
  write: "This agent was just added to your page, so for a day it can only post updates.\nWant me to post this week's update instead?",
  update_taken: "This week's update on your page came from your other agent, so I left it as it is.\nWant me to suggest one small thing to ship this week instead?",
} as const;

/**
 * TOCTOU (scan): every check here and the write it guards run in ONE transaction under the page's
 * advisory lock (`page_join:<current root>`), with the installation and join rows locked FOR UPDATE.
 * The installation row FOR UPDATE blocks a concurrent insert into every table that references
 * installations by foreign key (wallets, verify links, verifications, entries, token offers, hosted
 * sites, deploys, upload tokens, among others: see JOIN_TABLES). For tables keyed by builder_id without a
 * foreign key (sources, person wallets, coin moments), the protection is that the emptiness check and the
 * deletes run in that same transaction, the proof-branch lock (`proof_branch:<id>`), and discovery's own
 * check: discovery locks its OWN root (`page_join:<its root>`, not the page) and writes its verdicts only
 * while that root is still a root, so nothing it confirms lands on an installation attached meanwhile.
 */
const lockPage = (tx: Db, root: number) => tx`SELECT pg_advisory_xact_lock(hashtext(${`page_join:${root}`}))`;
export const lockPageJoin = lockPage;
const rootIn = async (db: Db, id: number) => (await db<{ root: number }[]>`SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${id}`)[0]?.root ?? null;

/**
 * Final review: every table keyed by an installation or a person (a column installation_id, builder_id,
 * posted_by or minted_by, or a foreign key to installations), and what an R1 one-click join does with the
 * newcomer's rows in it:
 * - `blocks`: a row (matching `when`, if given) means the newcomer is not fresh and empty: no one click;
 * - `discard`: its rows are deleted at the join (what its agent only reported, caches, leftovers), never
 *   merged; a `blocks` entry with `when` discards its other rows;
 * - `stays`: left as is (an append-only log, or a column that names an installation without being its data).
 * freshAndEmpty and attachFresh are built from it; db-check.mts and REG.1 fail on any table not listed.
 * Table and column names are constants (never input).
 */
export type JoinRule = 'blocks' | 'discard' | 'stays';
export const JOIN_TABLES: readonly { table: string; column: string; rule: JoinRule; when?: string; why: string }[] = [
  { table: 'installations', column: 'builder_id', rule: 'blocks', why: 'another installation in its group' },
  { table: 'builder_sources', column: 'builder_id', rule: 'blocks', when: "state = 'verified'", why: 'a confirmed source; proposed ones are only reported (R9)' },
  { table: 'github_verifications', column: 'installation_id', rule: 'blocks', why: 'a proven GitHub login' },
  { table: 'github_verify_nonces', column: 'installation_id', rule: 'blocks', when: 'used_at IS NULL AND expires_at > now()', why: 'an open verify link' },
  { table: 'person_wallets', column: 'builder_id', rule: 'blocks', why: 'a signed wallet' },
  { table: 'installation_wallets', column: 'installation_id', rule: 'blocks', why: 'a wallet' },
  { table: 'projects', column: 'installation_id', rule: 'blocks', why: 'entries and coins' },
  { table: 'coin_moments', column: 'builder_id', rule: 'blocks', why: 'a coin offered' },
  { table: 'token_offers', column: 'installation_id', rule: 'blocks', why: 'a token offered' },
  { table: 'hosted_sites', column: 'installation_id', rule: 'blocks', why: 'a hosted site' },
  { table: 'contract_deploys', column: 'installation_id', rule: 'blocks', why: 'a contract deploy' },
  { table: 'host_upload_tokens', column: 'installation_id', rule: 'blocks', when: 'expires_at > now()', why: 'an open hosting upload' },
  { table: 'proof_line_issues', column: 'installation_id', rule: 'blocks', why: 'a proof line issued for a repo' },
  { table: 'proof_branches', column: 'builder_id', rule: 'blocks', when: 'used_at IS NOT NULL', why: 'a proof branch that passed; open codes are discarded' },
  { table: 'project_updates', column: 'builder_id', rule: 'blocks', why: 'its own ship log' },
  { table: 'bonus_payouts', column: 'installation_id', rule: 'blocks', why: 'money' },
  { table: 'sponsor_campaigns', column: 'installation_id', rule: 'blocks', why: 'a sponsor campaign' },
  { table: 'digest_subscriptions', column: 'installation_id', rule: 'blocks', why: 'an email subscription' },
  { table: 'login_contest_rulings', column: 'builder_id', rule: 'blocks', why: "an owner's ruling" },
  { table: 'x_owner_clears', column: 'builder_id', rule: 'blocks', why: "an owner's clear" },
  { table: 'builder_profiles', column: 'builder_id', rule: 'blocks', when: 'x_user_id IS NOT NULL', why: 'an X claim; an unclaimed profile is discarded (R9)' },
  { table: 'answer_bank', column: 'installation_id', rule: 'discard', why: 'answers its agent typed' },
  { table: 'builder_program_status', column: 'installation_id', rule: 'discard', why: 'its program progress' },
  { table: 'builder_repo_facts', column: 'installation_id', rule: 'discard', why: 'a matcher cache' },
  { table: 'match_shown', column: 'installation_id', rule: 'discard', why: 'what matching showed it' },
  { table: 'token_declines', column: 'installation_id', rule: 'discard', why: 'a declined token' },
  { table: 'pending_joins', column: 'installation_id', rule: 'discard', why: 'its join asks' },
  { table: 'builder_live', column: 'builder_id', rule: 'discard', why: 'a derived score' },
  { table: 'builder_projects', column: 'builder_id', rule: 'discard', why: 'derived projects' },
  { table: 'builder_ranks', column: 'builder_id', rule: 'discard', why: 'a derived rank' },
  { table: 'builder_scores', column: 'builder_id', rule: 'discard', why: 'a derived score' },
  { table: 'score_releases', column: 'builder_id', rule: 'discard', why: 'a derived score release' },
  { table: 'claim_codes', column: 'builder_id', rule: 'discard', why: 'its own unclaimed claim code (R9)' },
  { table: 'discovery_queue', column: 'builder_id', rule: 'discard', why: 'its discovery queue row' },
  { table: 'profile_slug_history', column: 'builder_id', rule: 'discard', why: 'its unclaimed internal slugs' },
  { table: 'x_join_offers', column: 'builder_id', rule: 'discard', why: 'its other join offers' },
  { table: 'x_oauth_states', column: 'builder_id', rule: 'discard', why: 'its open X sign-ins' },
  { table: 'builder_events', column: 'installation_id', rule: 'stays', why: 'the append-only event log' },
  { table: 'claim_codes', column: 'minted_by', rule: 'stays', why: 'names who asked for a link, not its data' },
  { table: 'project_updates', column: 'posted_by', rule: 'stays', why: 'names who posted, not its data' },
];

/**
 * R8, R9, final review (I-1): the one-click join attaches only a fresh, empty installation (the reconnect
 * case): its own root with no payout wallet, and no `blocks` row in JOIN_TABLES (another member, a confirmed
 * source, a verification or open verify link, any wallet, entries or coins, coin moments, token offers, a
 * hosted site, a deploy, an open upload, a proof line, a passed proof branch, its own ship log, money, an X
 * claim, ...). What its agent only reported (proposed sources, the identity report, reported_github, its own
 * unclaimed claim code) never counts and is discarded at the join (R9). Anything else can't join by one
 * click (R10: under the Bench there is no X two-agent yes; a fresh connection is the way). A failed read is
 * not empty.
 */
export async function freshAndEmpty(id: number, db: Db = sql()): Promise<boolean> {
  const blocks = JOIN_TABLES.filter((t) => t.rule === 'blocks')
    .map((t) => `NOT EXISTS (SELECT 1 FROM ${t.table} WHERE ${t.column} = $1${t.when ? ` AND (${t.when})` : ''})`);
  const r = await db
    .unsafe<{ empty: boolean }[]>(`SELECT (i.builder_id IS NULL AND i.payout_wallet IS NULL AND ${blocks.join(' AND ')}) AS empty FROM installations i WHERE i.id = $1`, [id])
    .catch(() => []);
  return r[0]?.empty === true;
}

/**
 * R8, R9 (with R7 item 3): the R1 join in ONE locked transaction: the page's lock, the installation's row
 * and proof-branch lock; then the page still holds this X account and the installation is still fresh and
 * empty (checked under the locks); then it alone is attached, what its agent only reported is discarded
 * (nothing merged), and the join is recorded with the page's installations at this moment (`eligible`).
 * Null when any check fails (nothing written).
 */
export type AttachResult = { id: number } | { fail: 'gone' | 'not_empty' | 'shared' | 'paused' };
export async function attachFresh(o: { installation: number; page: number; xUserId: string; now: Date }): Promise<AttachResult> {
  return sql().begin(async (tx) => {
    await lockPage(tx, o.page);
    const [me] = await tx<{ builder_id: number | null; shared: boolean }[]>`SELECT builder_id, shared_client AS shared FROM installations WHERE id = ${o.installation} FOR UPDATE`;
    if (!me || me.builder_id !== null) return { fail: 'gone' as const };
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`proof_branch:${o.installation}`}))`;
    const [p] = await tx<{ x: string | null }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${o.page} FOR UPDATE`;
    if (p?.x !== o.xUserId || (await rootIn(tx, o.page)) !== o.page) return { fail: 'gone' as const };
    // Final review (minor): the shared-client and owner-clear checks are inside the locked transaction too.
    const [g] = await tx<{ shared: boolean | null }[]>`SELECT bool_or(shared_client) AS shared FROM installations WHERE COALESCE(builder_id, id) = ${o.page}`;
    if (me.shared || g?.shared) return { fail: 'shared' as const };
    const [cleared] = await tx`SELECT 1 FROM x_owner_clears WHERE x_user_id = ${o.xUserId}`;
    if (cleared) return { fail: 'paused' as const };
    if (!(await freshAndEmpty(o.installation, tx))) return { fail: 'not_empty' as const };
    const eligible = (await tx<{ id: number }[]>`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${o.page} ORDER BY id FOR UPDATE`).map((r) => r.id);
    if (eligible.includes(o.installation)) return { fail: 'gone' as const };
    await tx`UPDATE installations SET builder_id = ${o.page} WHERE id = ${o.installation}`;
    // R9 and the registry: every `discard` row, and a `blocks` table's other rows (it had none that block),
    // are deleted; nothing is merged into the page. The profile goes last.
    for (const t of JOIN_TABLES)
      if ((t.rule === 'discard' || (t.rule === 'blocks' && t.when)) && t.table !== 'builder_profiles')
        await tx.unsafe(`DELETE FROM ${t.table} WHERE ${t.column} = $1`, [o.installation]);
    await tx`DELETE FROM builder_profiles WHERE builder_id = ${o.installation}`;
    const [r] = await tx<{ id: number }[]>`
      INSERT INTO page_joins (root, from_root, members, eligible, x_user_id, joined_at)
      VALUES (${o.page}, ${o.installation}, ${[o.installation]}::int[], ${eligible}::int[], ${o.xUserId}, ${o.now}) RETURNING id::int AS id`;
    return r;
  });
}

/**
 * R8 item 5: page `root` (any installation of it) has an R1 join whose notice some eligible installation
 * still on the page hasn't answered: no tie-join (answerJoin) links anything onto it until then. A failed
 * read counts as open.
 */
export async function openR1Join(root: number): Promise<boolean> {
  const page = await rootIn(sql(), root).catch(() => null);
  if (page === null) return true;
  const [r] = await sql()`
    SELECT 1 FROM page_joins j JOIN installations r ON r.id = j.root
    WHERE COALESCE(r.builder_id, r.id) = ${page} AND j.detached_at IS NULL
      AND EXISTS (SELECT 1 FROM unnest(j.eligible) e JOIN installations i ON i.id = e
                  WHERE COALESCE(i.builder_id, i.id) = ${page} AND NOT (j.answers ? e::text))
    LIMIT 1`.catch(() => [1]);
  return Boolean(r);
}

/** R7: `own` joined a page by R1 less than PROBATION_MS ago and is still attached. */
export async function onProbation(own: number, now: Date = new Date(), db: Db = sql()): Promise<boolean> {
  const [r] = await db`
    SELECT 1 FROM page_joins j JOIN installations i ON i.id = ${own}
    WHERE ${own}::int = ANY(j.members) AND j.detached_at IS NULL AND j.joined_at > ${new Date(now.getTime() - PROBATION_MS)}
      AND COALESCE(i.builder_id, i.id) <> ${own} LIMIT 1`;
  return Boolean(r);
}

type JoinRow = { id: number; root: number; from_root: number; members: number[]; eligible: number[]; joined_at: Date; answers: Record<string, string>; detached_at: Date | null };
const JOIN_COLS = (db: Db) => db`j.id::int AS id, j.root, j.from_root, j.members, j.eligible, j.joined_at, j.answers, j.detached_at`;

/**
 * I-2, R8: `own` may answer join `j`: in the eligible snapshot, on the page now (its CURRENT root), not a
 * member, not a member of a still-attached join of the page with the same or a later id, not on probation.
 */
async function eligibleFor(db: Db, j: JoinRow, own: number): Promise<boolean> {
  if (j.detached_at || j.members.includes(own) || !j.eligible.includes(own)) return false;
  const [mine, page] = [await rootIn(db, own), await rootIn(db, j.root)];
  if (mine === null || page === null || mine !== page) return false;
  const [later] = await db`
    SELECT 1 FROM page_joins j JOIN installations r ON r.id = j.root
    WHERE COALESCE(r.builder_id, r.id) = ${page} AND j.detached_at IS NULL AND j.id >= ${j.id} AND ${own}::int = ANY(j.members) LIMIT 1`;
  if (later) return false;
  return !(await onProbation(own, new Date(), db));
}

/** The oldest join of page `root` that `own` may answer and hasn't (I-1): re-shown on every reply until answered. */
export async function pendingNotice(root: number, own: number): Promise<{ id: number; line: string } | null> {
  const db = sql();
  const page = await rootIn(db, root);
  if (page === null) return null;
  // R8: matched on the page's current root, filtered in SQL (eligible snapshot, unanswered) before any limit.
  const rows = await db<JoinRow[]>`
    SELECT ${JOIN_COLS(db)} FROM page_joins j JOIN installations r ON r.id = j.root
    WHERE COALESCE(r.builder_id, r.id) = ${page} AND j.detached_at IS NULL
      AND ${own}::int = ANY(j.eligible) AND NOT (j.answers ? ${String(own)})
    ORDER BY j.id`;
  for (const j of rows) if (await eligibleFor(db, j, own)) return { id: j.id, line: joinNoticeLine(j.joined_at) };
  return null;
}

export type NoticeAnswer = 'detached' | 'kept' | 'not_allowed' | 'none';

/**
 * I-1: installation `own`'s yes or no to join `joinId`'s notice, in ONE transaction under the page's lock
 * and the join row's lock: eligibility (on a yes and on a no), the answer, and on a yes the detach. Two
 * answers at once: the second waits, then sees the join detached ('none').
 */
export async function answerNotice(joinId: number, own: number, yes: boolean, now: Date = new Date()): Promise<NoticeAnswer> {
  const out = await sql().begin(async (tx) => {
    const [peek] = await tx<{ root: number }[]>`SELECT root FROM page_joins WHERE id = ${joinId}`;
    if (!peek) return { r: 'none' as const };
    const page = await rootIn(tx, peek.root);
    if (page === null) return { r: 'none' as const };
    await lockPage(tx, page);
    const [j] = await tx<JoinRow[]>`SELECT ${JOIN_COLS(tx)} FROM page_joins j WHERE j.id = ${joinId} FOR UPDATE`;
    if (!j || j.detached_at) return { r: 'none' as const };
    if ((await rootIn(tx, j.root)) !== page) return { r: 'none' as const }; // re-rooted meanwhile: ask again
    if (!(await eligibleFor(tx, j, own))) return { r: 'not_allowed' as const };
    await tx`UPDATE page_joins SET answers = answers || jsonb_build_object(${String(own)}::text, ${yes ? 'yes' : 'no'}::text) WHERE id = ${joinId}`;
    if (!yes) return { r: 'kept' as const };
    // Detach: the members back to their own former group (from_root a root again, the others pointing to
    // it), locked and matched on the page's current root (a no-op is never "Done"); their updates hidden.
    await tx`SELECT id FROM installations WHERE id = ANY(${j.members}::int[]) FOR UPDATE`;
    const moved = await tx<{ id: number }[]>`
      UPDATE installations SET builder_id = CASE WHEN id = ${j.from_root} THEN NULL ELSE ${j.from_root}::int END
      WHERE id = ANY(${j.members}::int[]) AND builder_id = ${page} RETURNING id`;
    if (!moved.length) return { r: 'none' as const };
    await tx`UPDATE project_updates SET hidden = true WHERE builder_id = ${page} AND posted_by = ANY(${j.members}::int[]) AND created_at >= ${j.joined_at}`;
    await tx`UPDATE page_joins SET detached_at = ${now}, detached_by = ${own} WHERE id = ${joinId}`;
    return { r: 'detached' as const, page, members: j.members };
  });
  if (out.r !== 'detached') return out.r;
  await noteEvent('page_detached', () => ({
    type: 'page_detached', dedupe_key: `page_detached:${joinId}`, installation_id: out.page, detail: { join: joinId, members: out.members, by: own },
  }));
  profileChanged();
  return 'detached';
}
