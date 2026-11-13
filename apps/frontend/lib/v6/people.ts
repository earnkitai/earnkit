/**
 * People: one row per person behind installations (the `people` table, read by the owner's `owner_people` view). An
 * install makes or finds its person; linking an installation to a builder joins them. A person flagged `test_reason`
 * is not real (the owner, the dogfood agents, journey personas, repro scripts); a reason is never cleared. Rows are
 * never deleted.
 */
import type { Db } from '../v5/db';

type Env = Record<string, string | undefined>;
export const TEST_REASONS = ['owner', 'dogfood', 'persona', 'repro', 'test'] as const;
export type TestReason = (typeof TEST_REASONS)[number];
export type TestFlag = { reason: TestReason; source: string };

/** The repro scripts' client-name tag (scripts/repro/lib.mts): `l33-<id>-...`. */
const REPRO_TAG = /^l\d+[a-z0-9]*-/i;

/** A comma list as lower-case entries, a leading @ dropped. Pure. */
const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);

/**
 * Why this installation or person is not a real one, or null. Sources, first match wins: EARNKIT_TEST_INSTALLATIONS
 * (installation ids) is `test`; EARNKIT_OWNER_LOGINS and EARNKIT_DOGFOOD_LOGINS (GitHub logins or X handles) are
 * `owner` and `dogfood`; a client name in the repro tag shape is `repro`; one holding `dogfood` is `dogfood`, `persona`
 * or `journey` is `persona`. Unset variables flag nothing. Pure.
 */
export function testReasonFor(
  who: { clientName?: string | null; githubLogin?: string | null; xHandle?: string | null; installationId?: number | null },
  env: Env = process.env,
): TestFlag | null {
  if (who.installationId != null && list(env.EARNKIT_TEST_INSTALLATIONS).includes(String(who.installationId))) return { reason: 'test', source: 'EARNKIT_TEST_INSTALLATIONS' };
  const names = [who.githubLogin, who.xHandle].map((s) => (s ?? '').replace(/^@/, '').toLowerCase()).filter(Boolean);
  if (names.some((n) => list(env.EARNKIT_OWNER_LOGINS).includes(n))) return { reason: 'owner', source: 'EARNKIT_OWNER_LOGINS' };
  if (names.some((n) => list(env.EARNKIT_DOGFOOD_LOGINS).includes(n))) return { reason: 'dogfood', source: 'EARNKIT_DOGFOOD_LOGINS' };
  const name = who.clientName ?? '';
  if (REPRO_TAG.test(name)) return { reason: 'repro', source: 'client_name tag' };
  if (/dogfood/i.test(name)) return { reason: 'dogfood', source: 'client_name' };
  if (/persona|journey/i.test(name)) return { reason: 'persona', source: 'client_name' };
  return null;
}

/** Makes the installation's person (flagged by its client name) when it has none. Returns the person's id. */
export async function ensurePerson(db: Db, installationId: number, clientName: string | null): Promise<number> {
  const [cur] = await db<{ person_id: number | null }[]>`SELECT person_id FROM installations WHERE id = ${installationId} FOR UPDATE`;
  if (cur?.person_id != null) return cur.person_id;
  const flag = testReasonFor({ clientName, installationId });
  const [p] = await db<{ id: number }[]>`INSERT INTO people (test_reason, test_reason_source) VALUES (${flag?.reason ?? null}, ${flag?.source ?? null}) RETURNING id`;
  await db`UPDATE installations SET person_id = ${p.id} WHERE id = ${installationId}`;
  return p.id;
}

/** Sets a person's reason unless it has one (never cleared, never replaced). */
const flagPerson = (db: Db, id: number, flag: TestFlag | null) =>
  flag ? db`UPDATE people SET test_reason = ${flag.reason}, test_reason_source = ${flag.source} WHERE id = ${id} AND test_reason IS NULL` : Promise.resolve();

/**
 * Joins the installation's person with the builder's, in the caller's transaction (linkInstallation). The builder
 * already has a person: the installation moves to it, carrying the old person's reason when the builder's has none (the
 * old row stays, empty). Else the installation's person becomes the builder's (a person of another builder is left
 * alone and a new one made). The GitHub login is checked for a reason.
 */
export async function linkPerson(db: Db, installationId: number, builderId: number, env: Env = process.env): Promise<void> {
  const [inst] = await db<{ person_id: number | null; client_name: string | null; login: string | null }[]>`
    SELECT i.person_id, i.client_name, (SELECT login FROM builders WHERE id = ${builderId}) AS login FROM installations i WHERE i.id = ${installationId}`;
  if (!inst) return;
  const flag = testReasonFor({ clientName: inst.client_name, githubLogin: inst.login, installationId }, env);
  const [mine] = await db<{ id: number }[]>`SELECT id FROM people WHERE builder_id = ${builderId}`;
  const [old] = inst.person_id == null ? [] : await db<{ builder_id: number | null; test_reason: string | null; test_reason_source: string | null }[]>`
    SELECT builder_id, test_reason, test_reason_source FROM people WHERE id = ${inst.person_id}`;
  if (mine) {
    if (inst.person_id !== mine.id) await db`UPDATE installations SET person_id = ${mine.id} WHERE id = ${installationId}`;
    if (old?.test_reason) await flagPerson(db, mine.id, { reason: old.test_reason as TestReason, source: old.test_reason_source ?? 'carried' });
    await flagPerson(db, mine.id, flag);
    return;
  }
  if (inst.person_id != null && old && old.builder_id == null) {
    await db`UPDATE people SET builder_id = ${builderId} WHERE id = ${inst.person_id}`;
    await flagPerson(db, inst.person_id, flag);
    return;
  }
  const carried = old?.test_reason ? { reason: old.test_reason as TestReason, source: old.test_reason_source ?? 'carried' } : flag;
  const [p] = await db<{ id: number }[]>`INSERT INTO people (builder_id, test_reason, test_reason_source) VALUES (${builderId}, ${carried?.reason ?? null}, ${carried?.source ?? null}) RETURNING id`;
  await db`UPDATE installations SET person_id = ${p.id} WHERE id = ${installationId}`;
  await flagPerson(db, p.id, flag);
}
