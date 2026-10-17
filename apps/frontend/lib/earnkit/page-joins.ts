import { sql } from './db';
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
 * R8: the one-click join attaches only a fresh, empty installation (the reconnect case): a single
 * installation (its own root, no other members), no verified or proposed sources, no GitHub verification
 * and no open verify link, no wallet (person_wallets, installation_wallets, payout_wallet), no entries or
 * coins (projects), coin moments or token offers, and no X claim. Anything else gets the two-agent yes.
 * A failed read is not empty.
 */
export async function freshAndEmpty(id: number): Promise<boolean> {
  const [r] = await sql()<{ empty: boolean }[]>`
    SELECT (i.builder_id IS NULL AND i.payout_wallet IS NULL
      AND NOT EXISTS (SELECT 1 FROM installations m WHERE m.builder_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${id} AND s.state IN ('verified', 'proposed'))
      AND NOT EXISTS (SELECT 1 FROM github_verifications v WHERE v.installation_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM github_verify_nonces n WHERE n.installation_id = ${id} AND n.used_at IS NULL AND n.expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM person_wallets w WHERE w.builder_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM installation_wallets w WHERE w.installation_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.installation_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM coin_moments c WHERE c.builder_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM token_offers t WHERE t.installation_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM builder_profiles b WHERE b.builder_id = ${id} AND b.x_user_id IS NOT NULL)) AS empty
    FROM installations i WHERE i.id = ${id}`.catch(() => []);
  return r?.empty === true;
}

/**
 * R8 (with R7 item 3): the R1 join in ONE transaction: the page still holds this X account, the
 * installation is still fresh and empty, then it alone is attached to the page (its own empty profile
 * rows are dropped, nothing of it merged) and the join is recorded with the page's installations at
 * this moment (`eligible`). Null when any check fails (nothing written).
 */
export async function attachFresh(o: { installation: number; page: number; xUserId: string; now: Date }): Promise<{ id: number } | null> {
  return sql().begin(async (tx) => {
    const [p] = await tx<{ x: string | null }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${o.page} FOR UPDATE`;
    if (p?.x !== o.xUserId) return null;
    const [me] = await tx<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${o.installation} FOR UPDATE`;
    if (!me || me.builder_id !== null) return null;
    const eligible = (await tx<{ id: number }[]>`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${o.page} ORDER BY id`).map((r) => r.id);
    if (eligible.includes(o.installation)) return null;
    const moved = await tx`
      UPDATE installations SET builder_id = ${o.page}
      WHERE id = ${o.installation} AND builder_id IS NULL AND NOT EXISTS (SELECT 1 FROM installations m WHERE m.builder_id = ${o.installation}) RETURNING id`;
    if (!moved.length) return null;
    // Its own empty person rows (made by its first find) are dropped; nothing is merged into the page.
    await tx`DELETE FROM builder_live WHERE builder_id = ${o.installation}`;
    await tx`DELETE FROM builder_projects WHERE builder_id = ${o.installation}`;
    await tx`DELETE FROM claim_codes WHERE builder_id = ${o.installation}`;
    await tx`DELETE FROM builder_sources WHERE builder_id = ${o.installation}`;
    await tx`DELETE FROM builder_profiles WHERE builder_id = ${o.installation}`;
    const [r] = await tx<{ id: number }[]>`
      INSERT INTO page_joins (root, from_root, members, eligible, x_user_id, joined_at)
      VALUES (${o.page}, ${o.installation}, ${[o.installation]}::int[], ${eligible}::int[], ${o.xUserId}, ${o.now}) RETURNING id::int AS id`;
    return r;
  });
}

const rootOfSql = (id: number) => sql()<{ root: number }[]>`SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${id}`;

/**
 * R8 item 5: page `root` (any installation of it) has an R1 join whose notice some eligible installation
 * still on the page hasn't answered: no tie-join (answerJoin) links anything onto it until then.
 */
export async function openR1Join(root: number): Promise<boolean> {
  const [page] = await rootOfSql(root);
  if (!page) return true;
  const [r] = await sql()`
    SELECT 1 FROM page_joins j JOIN installations r ON r.id = j.root
    WHERE COALESCE(r.builder_id, r.id) = ${page.root} AND j.detached_at IS NULL
      AND EXISTS (SELECT 1 FROM unnest(j.eligible) e JOIN installations i ON i.id = e
                  WHERE COALESCE(i.builder_id, i.id) = ${page.root} AND NOT (j.answers ? e::text))
    LIMIT 1`.catch(() => [1]);
  return Boolean(r);
}

/** R7: `own` joined a page by R1 less than PROBATION_MS ago and is still attached. */
export async function onProbation(own: number, now: Date = new Date()): Promise<boolean> {
  const [r] = await sql()`
    SELECT 1 FROM page_joins j JOIN installations i ON i.id = ${own}
    WHERE ${own}::int = ANY(j.members) AND j.detached_at IS NULL AND j.joined_at > ${new Date(now.getTime() - PROBATION_MS)}
      AND COALESCE(i.builder_id, i.id) <> ${own} LIMIT 1`;
  return Boolean(r);
}

type JoinRow = { id: number; root: number; from_root: number; members: number[]; eligible: number[]; joined_at: Date; answers: Record<string, string>; detached_at: Date | null };

/**
 * I-2: `own` may answer join `j`: it is on that page now (the page's current root), it is not one of the
 * join's members, and it is not a member of any still-attached join of the page with the same or a later id
 * (so a later newcomer never answers for an earlier one). Not on probation itself.
 */
async function eligibleFor(j: JoinRow, own: number): Promise<boolean> {
  // R8: only an installation that was on the page when it joined (the snapshot), still on it now (the
  // page's CURRENT root, whatever it re-rooted to), never a member, never on probation.
  if (j.detached_at || j.members.includes(own) || !j.eligible.includes(own)) return false;
  const [[mine], [page]] = await Promise.all([rootOfSql(own), rootOfSql(j.root)]);
  if (!mine || !page || mine.root !== page.root) return false;
  const [later] = await sql()`
    SELECT 1 FROM page_joins j JOIN installations r ON r.id = j.root
    WHERE COALESCE(r.builder_id, r.id) = ${page.root} AND j.detached_at IS NULL AND j.id >= ${j.id} AND ${own}::int = ANY(j.members) LIMIT 1`;
  if (later) return false;
  return !(await onProbation(own));
}

/** The oldest join of page `root` that `own` may answer and hasn't (I-1): re-shown on every reply until answered. */
export async function pendingNotice(root: number, own: number): Promise<{ id: number; line: string } | null> {
  const [page] = await rootOfSql(root);
  if (!page) return null;
  // R8: matched on the page's current root, filtered in SQL (eligible snapshot, unanswered) before any limit.
  const rows = await sql()<JoinRow[]>`
    SELECT j.id::int AS id, j.root, j.from_root, j.members, j.eligible, j.joined_at, j.answers, j.detached_at
    FROM page_joins j JOIN installations r ON r.id = j.root
    WHERE COALESCE(r.builder_id, r.id) = ${page.root} AND j.detached_at IS NULL
      AND ${own}::int = ANY(j.eligible) AND NOT (j.answers ? ${String(own)})
    ORDER BY j.id`;
  for (const j of rows) if (await eligibleFor(j, own)) return { id: j.id, line: joinNoticeLine(j.joined_at) };
  return null;
}

export type NoticeAnswer = 'detached' | 'kept' | 'not_allowed' | 'none';

/**
 * I-1: installation `own`'s yes or no to join `joinId`'s notice. Eligibility is checked on both. A no is
 * recorded for `own` only. A yes detaches the members at once (detachJoin).
 */
export async function answerNotice(joinId: number, own: number, yes: boolean, now: Date = new Date()): Promise<NoticeAnswer> {
  const [j] = await sql()<JoinRow[]>`
    SELECT id::int AS id, root, from_root, members, eligible, joined_at, answers, detached_at FROM page_joins WHERE id = ${joinId}`;
  if (!j) return 'none';
  if (j.detached_at) return 'none';
  if (!(await eligibleFor(j, own))) return 'not_allowed';
  await sql()`UPDATE page_joins SET answers = answers || jsonb_build_object(${String(own)}::text, ${yes ? 'yes' : 'no'}::text) WHERE id = ${joinId}`;
  if (!yes) return 'kept';
  return (await detachJoin(joinId, own, now)) ? 'detached' : 'none';
}

/**
 * Moves the join's members back to their own former group (from_root becomes a root again, the others point
 * to it), matched on the page's current root so a no-op is never reported as done, and hides their updates
 * since the join. True when something was detached.
 */
async function detachJoin(joinId: number, by: number, now: Date): Promise<boolean> {
  const out = await sql().begin(async (tx) => {
    const [j] = await tx<JoinRow[]>`
      SELECT id::int AS id, root, from_root, members, eligible, joined_at, answers, detached_at FROM page_joins WHERE id = ${joinId} FOR UPDATE`;
    if (!j || j.detached_at) return null;
    const [page] = await tx<{ root: number }[]>`SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${j.root}`;
    if (!page) return null;
    const moved = await tx<{ id: number }[]>`
      UPDATE installations SET builder_id = CASE WHEN id = ${j.from_root} THEN NULL ELSE ${j.from_root}::int END
      WHERE id = ANY(${j.members}::int[]) AND builder_id = ${page.root} RETURNING id`;
    if (!moved.length) return null;
    await tx`UPDATE project_updates SET hidden = true WHERE builder_id = ${page.root} AND posted_by = ANY(${j.members}::int[]) AND created_at >= ${j.joined_at}`;
    await tx`UPDATE page_joins SET detached_at = ${now}, detached_by = ${by} WHERE id = ${joinId}`;
    return { root: page.root, members: j.members };
  });
  if (!out) return false;
  await noteEvent('page_detached', () => ({
    type: 'page_detached', dedupe_key: `page_detached:${joinId}`, installation_id: out.root, detail: { join: joinId, members: out.members, by },
  }));
  profileChanged();
  return true;
}
