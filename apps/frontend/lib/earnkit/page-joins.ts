import { sql } from './db';
import { noteEvent } from './events';
import { profileChanged } from './profile-cache';

/**
 * v2.13.4 R6 (controller ruling, answering a security scan: the R1 one-click join is weaker than the
 * two-agent yes it replaced). After an R1 join:
 * - every other installation already on the page is told once, on its next find or score, as that
 *   reply's question (joinNotice): "A new agent was added to your page on <date>. Not you? Want me to
 *   remove it?";
 * - a yes from any of them detaches the joined installations at once (detachJoin): they go back to their
 *   own unclaimed state, their updates since the join are hidden, their proof codes are closed (a repo one
 *   of them confirmed since the join is unconfirmed again), and a community round one of them opened that
 *   hasn't launched is removed; logged as page_detached;
 * - for 24 hours a joined installation can't open a community round or change the main project
 *   (newlyJoined); it can post updates.
 */
export const NEW_AGENT_HOLD_MS = 24 * 60 * 60_000;

/** The notice, as the reply's last line (its question). `date` as "Oct 17". Pure. */
export const joinNoticeLine = (date: Date) =>
  `A new agent was added to your page on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}. Not you? Want me to remove it?`;
export const DETACH_LINES = {
  done: "Done. That agent is off your page, and nothing it did since it joined counts for it.",
  kept: 'Okay. It stays on your page.',
} as const;
/** R6 (4): what a newly joined agent reads when it tries. */
export const NEW_AGENT_LINES = {
  coin: "This agent joined your page less than a day ago, so it can't open a community round yet. Try again tomorrow.",
  main: "This agent joined your page less than a day ago, so it can't change your project yet.",
} as const;

/** Records an R1 join (claim.ts claimJoinPost). Returns its id. */
export async function recordJoin(root: number, members: number[], xUserId: string, now: Date): Promise<number> {
  const [r] = await sql()<{ id: number }[]>`
    INSERT INTO page_joins (root, members, x_user_id, joined_at) VALUES (${root}, ${members}::int[], ${xUserId}, ${now}) RETURNING id::int AS id`;
  return r.id;
}

/**
 * The notice for installation `own` of the page `root`, once per join: the oldest join not yet shown to
 * it, that it is not a member of, made after `own` was installed, and not detached. Marks it shown.
 */
export async function joinNotice(root: number, own: number): Promise<{ id: number; line: string } | null> {
  const [j] = await sql()<{ id: number; joined_at: Date }[]>`
    SELECT j.id::int AS id, j.joined_at FROM page_joins j JOIN installations i ON i.id = ${own}
    WHERE j.root = ${root} AND j.detached_at IS NULL AND NOT (${own}::int = ANY(j.members)) AND NOT (${own}::int = ANY(j.seen))
      AND i.created_at < j.joined_at AND COALESCE(i.builder_id, i.id) = ${root}
    ORDER BY j.id LIMIT 1`;
  if (!j) return null;
  await sql()`UPDATE page_joins SET seen = array_append(seen, ${own}::int) WHERE id = ${j.id}`;
  return { id: j.id, line: joinNoticeLine(j.joined_at) };
}

/** R6 (4): `own` joined a page by R1 less than a day ago (and was not detached since). */
export async function newlyJoined(own: number, now: Date = new Date()): Promise<boolean> {
  const [r] = await sql()`
    SELECT 1 FROM page_joins WHERE ${own}::int = ANY(members) AND detached_at IS NULL AND joined_at > ${new Date(now.getTime() - NEW_AGENT_HOLD_MS)} LIMIT 1`;
  return Boolean(r);
}

export type DetachResult = 'detached' | 'not_allowed' | 'none';

/**
 * R6 (3): installation `by` (one already on the page before the join) detaches join `joinId`'s members
 * at once. Refused for a member, a newer installation or another person; a join already detached is 'none'.
 */
export async function detachJoin(joinId: number, by: number, now: Date = new Date()): Promise<DetachResult> {
  const out = await sql().begin(async (tx) => {
    const [j] = await tx<{ root: number; members: number[]; joined_at: Date; detached_at: Date | null }[]>`
      SELECT root, members, joined_at, detached_at FROM page_joins WHERE id = ${joinId} FOR UPDATE`;
    if (!j || j.detached_at) return { r: 'none' as const };
    const [me] = await tx<{ root: number; created_at: Date }[]>`SELECT COALESCE(builder_id, id) AS root, created_at FROM installations WHERE id = ${by}`;
    if (!me || me.root !== j.root || j.members.includes(by) || !(me.created_at < j.joined_at)) return { r: 'not_allowed' as const };
    // Back to their own unclaimed state: no longer in the page's group (the next find makes a fresh profile).
    await tx`UPDATE installations SET builder_id = NULL WHERE id = ANY(${j.members}::int[]) AND builder_id = ${j.root}`;
    // Their updates since the join stop counting for the page.
    await tx`UPDATE project_updates SET hidden = true WHERE builder_id = ${j.root} AND posted_by = ANY(${j.members}::int[]) AND created_at >= ${j.joined_at}`;
    // Their open proof codes are closed; a repo one of their codes confirmed since the join is unconfirmed.
    await tx`UPDATE proof_branches SET closed_at = ${now} WHERE builder_id = ${j.root} AND asked_by = ANY(${j.members}::int[]) AND used_at IS NULL AND closed_at IS NULL`;
    const used = await tx<{ repo_key: string }[]>`
      SELECT DISTINCT repo_key FROM proof_branches WHERE builder_id = ${j.root} AND asked_by = ANY(${j.members}::int[]) AND used_at >= ${j.joined_at}`;
    for (const u of used)
      await tx`
        UPDATE builder_sources SET state = 'proposed', verified_at = NULL
        WHERE builder_id = ${j.root} AND kind = 'repo' AND lower(ref) = ${u.repo_key.toLowerCase()} AND proof = 'proof_branch' AND state = 'verified' AND verified_at >= ${j.joined_at}`;
    // A community round one of them opened that hasn't launched (and isn't launching) never launches.
    await tx`
      DELETE FROM projects WHERE opened_by = ANY(${j.members}::int[]) AND program_id = 'earnkit-coin' AND token_url IS NULL AND token_claimed_at IS NULL`;
    await tx`UPDATE page_joins SET detached_at = ${now}, detached_by = ${by} WHERE id = ${joinId}`;
    return { r: 'detached' as const, root: j.root, members: j.members, unconfirmed: used.length > 0 };
  });
  if (out.r !== 'detached') return out.r;
  if (out.unconfirmed) await (await import('./person-score')).rescorePerson(out.root, now).catch((err: unknown) => console.error('[page-joins] rescore', err instanceof Error ? err.name : 'error'));
  await noteEvent('page_detached', () => ({
    type: 'page_detached', dedupe_key: `page_detached:${joinId}`, installation_id: out.root, detail: { join: joinId, members: out.members, by },
  }));
  profileChanged();
  return 'detached';
}
