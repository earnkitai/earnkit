/**
 * People: one row per person behind installations (the `people` table, read by the owner's `owner_people` view). An
 * install makes or finds its person; linking an installation to a builder joins them. A person flagged `test_reason`
 * is not real (the owner, the dogfood agents, journey personas, repro scripts). Nothing automatic clears a reason; the
 * backfill's `--unflag` does, by hand. The app never deletes a row (the repro cleanups remove their own).
 */
import type { Db } from '../v5/db';

type Env = Record<string, string | undefined>;
export const TEST_REASONS = ['owner', 'dogfood', 'persona', 'repro', 'test'] as const;
export type TestReason = (typeof TEST_REASONS)[number];
export type TestFlag = { reason: TestReason; source: string };

/** The sources that are env lists (the owner's own word). Only these reach a builder's person at link (v6.1.21 I2). */
export const ENV_SOURCES = ['EARNKIT_TEST_INSTALLATIONS', 'EARNKIT_OWNER_LOGINS', 'EARNKIT_DOGFOOD_LOGINS'] as const;
/** Whether a reason's source is one of the env lists. Pure. */
export const fromEnvList = (source: string | null | undefined): boolean => (ENV_SOURCES as readonly string[]).includes(source ?? '');
/** The source an `--unflag` leaves (reason NULL): nothing automatic flags that person again. */
export const UNFLAGGED = 'unflagged';

/** Stronger signals win: owner over dogfood over the test kinds (test, persona, repro); 0 for none. Pure. */
export const reasonRank = (r: string | null | undefined): number => (r === 'owner' ? 3 : r === 'dogfood' ? 2 : r ? 1 : 0);

/** The repro scripts' client-name tag (scripts/repro/lib.mts, `l33-<id>-...`): a lane prefix (v6.1.21 I2). */
const REPRO_TAG = /^l\d+-/i;
/** v6.1.22: the live persona lanes' client names (`Lane 1h`, `lane1k`): `lane`, at most one space, then a digit, so a
 *  bare `Lane`, `lane-1`, a product like `Lanely` or `Lane AI` is not one (final fix round, I4). */
const LANE_TAG = /^lane ?\d/i;
/**
 * The client-name words (v6.1.21 I2), each as a whole word: a dash, underscore or space or the end of the name on both
 * sides, and the name holds at least one separator. So `Personal Assistant`, `my-personal-agent`, `Dogfooding Inc` and
 * a bare `Journey` (a product name) are not flagged; `journey-runner`, `My Persona`, `claude_test` are. First match wins.
 */
const NAME_WORDS: [RegExp, TestReason][] = (
  [
    ['dogfood', 'dogfood'],
    ['persona', 'persona'],
    ['journey', 'persona'],
    // v6.1.22: the first-run audits' tag (`firstrun-audit`), never the bare word audit (final fix round, I4: a product
    // such as `Code Audit Agent` stays real).
    ['firstrun-audit', 'persona'],
    ['repro', 'repro'],
    ['test', 'test'],
  ] as const
).map(([w, r]) => [new RegExp(`(?:^|[-_ ])${w}(?:[-_ ]|$)`, 'i'), r]);

/** A comma list as lower-case entries, a leading @ dropped. Pure. */
const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);

/** Why a client name marks a test install, or null: a lane prefix is `repro`, else the words above. Pure. */
export function clientNameReason(clientName: string | null | undefined): TestFlag | null {
  const name = (clientName ?? '').trim();
  if (REPRO_TAG.test(name)) return { reason: 'repro', source: 'client_name tag' };
  if (LANE_TAG.test(name)) return { reason: 'persona', source: 'client_name tag' };
  if (!/[-_ ]/.test(name)) return null;
  for (const [re, reason] of NAME_WORDS) if (re.test(name)) return { reason, source: 'client_name' };
  return null;
}

/**
 * The env-list reason, or null: EARNKIT_TEST_INSTALLATIONS (installation ids) is `test`; EARNKIT_OWNER_LOGINS and
 * EARNKIT_DOGFOOD_LOGINS (GitHub logins or X handles) are `owner` and `dogfood`, strongest first. The logins and handles
 * passed must be proven ones (a builder's GitHub login, a legacy X sign-in), never a claimed repo owner (v6.1.21 M4).
 * Unset variables flag nothing. Pure.
 */
export function envListReason(
  who: { githubLogin?: string | null; xHandle?: string | null; installationId?: number | null; installationIds?: number[] },
  env: Env = process.env,
): TestFlag | null {
  const names = [who.githubLogin, who.xHandle].map((s) => (s ?? '').replace(/^@/, '').toLowerCase()).filter(Boolean);
  if (names.some((n) => list(env.EARNKIT_OWNER_LOGINS).includes(n))) return { reason: 'owner', source: 'EARNKIT_OWNER_LOGINS' };
  if (names.some((n) => list(env.EARNKIT_DOGFOOD_LOGINS).includes(n))) return { reason: 'dogfood', source: 'EARNKIT_DOGFOOD_LOGINS' };
  const ids = [...(who.installationIds ?? []), ...(who.installationId != null ? [who.installationId] : [])].map(String);
  const testIds = list(env.EARNKIT_TEST_INSTALLATIONS);
  if (ids.some((i) => testIds.includes(i))) return { reason: 'test', source: 'EARNKIT_TEST_INSTALLATIONS' };
  return null;
}

/** Why this installation or person is not a real one, or null: the env lists (`envListReason`), then the client name. Pure. */
export function testReasonFor(
  who: { clientName?: string | null; githubLogin?: string | null; xHandle?: string | null; installationId?: number | null },
  env: Env = process.env,
): TestFlag | null {
  return envListReason(who, env) ?? clientNameReason(who.clientName);
}

/** Makes the installation's person (flagged by its client name or its id) when it has none. Returns the person's id. */
export async function ensurePerson(db: Db, installationId: number, clientName: string | null): Promise<number> {
  const [cur] = await db<{ person_id: number | null }[]>`SELECT person_id FROM installations WHERE id = ${installationId} FOR UPDATE`;
  if (cur?.person_id != null) return cur.person_id;
  const flag = testReasonFor({ clientName, installationId });
  const [p] = await db<{ id: number }[]>`INSERT INTO people (test_reason, test_reason_source) VALUES (${flag?.reason ?? null}, ${flag?.source ?? null}) RETURNING id`;
  await db`UPDATE installations SET person_id = ${p.id} WHERE id = ${installationId}`;
  return p.id;
}

/** Sets a person's reason unless it has one or was unflagged by hand (never cleared, never replaced). */
const flagPerson = (db: Db, id: number, flag: TestFlag | null) =>
  flag
    ? db`UPDATE people SET test_reason = ${flag.reason}, test_reason_source = ${flag.source}
        WHERE id = ${id} AND test_reason IS NULL AND test_reason_source IS DISTINCT FROM ${UNFLAGGED}`
    : Promise.resolve();

/**
 * Joins the installation's person with the builder's, in the caller's transaction (linkInstallation). The builder row is
 * locked first (v6.1.21 M2), so two first links to one builder never both make its person. The builder already has a
 * person: the installation moves to it (the old row stays, empty). Else the installation's person becomes the builder's,
 * unless it belongs to another builder or carries a client-name reason; then a new person is made for the builder and
 * the installation moves. Only env-list reasons reach the builder's person (the builder's GitHub login and the
 * installation id checked here, or the old person's env-list reason); a client-name reason never does (v6.1.21 I2).
 */
export async function linkPerson(db: Db, installationId: number, builderId: number, env: Env = process.env): Promise<void> {
  const [b] = await db<{ login: string | null }[]>`SELECT login FROM builders WHERE id = ${builderId} FOR UPDATE`;
  // A builder deleted since the code was issued: the link fails, and the caller's transaction with it (M3).
  if (!b) throw new Error(`linkPerson: builder ${builderId} does not exist`);
  const [inst] = await db<{ person_id: number | null }[]>`SELECT person_id FROM installations WHERE id = ${installationId}`;
  if (!inst) return;
  const flag = envListReason({ githubLogin: b.login, installationId }, env);
  const [mine] = await db<{ id: number }[]>`SELECT id FROM people WHERE builder_id = ${builderId}`;
  const [old] = inst.person_id == null ? [] : await db<{ builder_id: number | null; test_reason: string | null; test_reason_source: string | null }[]>`
    SELECT builder_id, test_reason, test_reason_source FROM people WHERE id = ${inst.person_id}`;
  const carried: TestFlag | null = old?.test_reason && fromEnvList(old.test_reason_source) ? { reason: old.test_reason as TestReason, source: old.test_reason_source as string } : null;
  if (mine) {
    if (inst.person_id !== mine.id) {
      await db`UPDATE installations SET person_id = ${mine.id} WHERE id = ${installationId}`;
      await flagPerson(db, mine.id, carried);
    }
    await flagPerson(db, mine.id, flag);
    return;
  }
  if (inst.person_id != null && old && old.builder_id == null && (!old.test_reason || fromEnvList(old.test_reason_source))) {
    await db`UPDATE people SET builder_id = ${builderId} WHERE id = ${inst.person_id}`;
    await flagPerson(db, inst.person_id, flag);
    return;
  }
  const first = carried ?? flag;
  const [p] = await db<{ id: number }[]>`INSERT INTO people (builder_id, test_reason, test_reason_source) VALUES (${builderId}, ${first?.reason ?? null}, ${first?.source ?? null}) RETURNING id`;
  await db`UPDATE installations SET person_id = ${p.id} WHERE id = ${installationId}`;
  await flagPerson(db, p.id, flag);
}
