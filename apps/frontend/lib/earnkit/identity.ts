import type postgres from 'postgres';
import { sql } from './db';

/**
 * v2.8.1 §E18, v2.12.1 spec "Identity": installations of one person are one group (builder_id points at the
 * root). v2.14 "One account": the person is the X account. An installation joins a page only by signing in with
 * that X (x-install.ts attachToX, at install or by the paste code), and always ALONE: no pickup, no proven-tie
 * join, no claim-page join, no probation or notice, and no group merge (the v2.14 no-merge ruling). Groups made
 * before v2.14 stay as they are (the bind migration detached joins nobody answered, preflight S4).
 */

/** This installation's group root (itself when it isn't linked). */
export async function rootOf(installationId: number): Promise<number> {
  const [row] = await sql()<{ root: number }[]>`
    SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${installationId}`;
  return row?.root ?? installationId;
}

/**
 * v2.14: one person's advisory lock (was page-joins.ts lockPage): attachToX, proveByApp and discovery's verdicts hold it.
 *
 * The global lock order, the same everywhere a group or its proofs change (so two of them never wait on each
 * other in a cycle):
 * 1. the X advisory locks `x_attach:<id>`, `x_user:<id>`, `x_handle:<h>` (x-install.ts attachToX, bindXIn), or
 *    repo-proof.ts proveByApp's `repo_hold:<key>` (no transaction takes both kinds);
 * 2. `person:<root>` (this lock), for every root involved, in ascending order (attachToX: the installation's
 *    root and the X's page; discovery.ts: its own root, before it writes verdicts; repo-proof.ts proveByApp: the
 *    person it proves for);
 * 3. `source_proof:<id>` (proveByApp, after the person lock);
 * 4. installation rows FOR UPDATE, in id order, in one statement;
 * 5. builder_profiles rows FOR UPDATE, in builder_id order, in one statement.
 */
export async function lockPerson(tx: postgres.TransactionSql, root: number): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`person:${root}`}))`;
}
