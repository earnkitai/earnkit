import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { assertLocalPostgres } from './local-postgres.mjs';

export { assertLocalPostgres };

const FRONTEND = join(import.meta.dirname, '..', '..', '..');
const ROOT = join(FRONTEND, '..', '..');
const TEMPLATE_DB = 'ek_test_template';
const hash = (s) => createHash('sha256').update(s).digest('hex');
/**
 * the test server is shared by every worktree. Each worktree gets its own template
 * (ek_test_template_<key>) and tags every database it makes with `ek_test <key>`, so a build or a cleanup
 * here never drops another worktree's databases.
 */
export const WORKTREE_KEY = hash(ROOT).slice(0, 8);
export const TEMPLATE_NAME = `${TEMPLATE_DB}_${WORKTREE_KEY}`;
export const TAG = `ek_test ${WORKTREE_KEY}`;
export const TEST_DB_NAME = /^ek_t_[0-9a-f]{10}_(\d+)$/;
export const at = (url, db) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
export const tagOf = async (admin, name) =>
  (await admin`SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = ${name}`)[0]?.c;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/**
 * Builds this worktree's template: schema.sql twice (the rerun proof), then programs-sync, then marks it a
 * template. The template's tag carries the schema's hash, so `ifMissing` (a single-file run) rebuilds it
 * when schema.sql changed. With `fresh` (the root `pnpm test`), it always rebuilds and drops this worktree's
 * leftover ek_t_* databases whose process is gone (a crashed earlier run); nothing else. Serialized by an
 * advisory lock, so concurrent first files wait for one build.
 */
/** The clock the template's catalog sync reads: the tests' own NOW, so a close date passing in real time never
 *  closes a program the tests read as open (Monad Blitz Oregon closed at 2026-11-11T07:59Z). */
const SYNC_NOW = '2026-11-04T12:00:00Z';

export async function buildTemplate(adminUrl, { fresh = false, ifMissing = false } = {}) {
  assertLocalPostgres(adminUrl);
  const schema = readFileSync(join(FRONTEND, 'db', 'schema.sql'), 'utf8');
  const templateTag = `${TAG} ${hash(schema).slice(0, 12)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`SELECT pg_advisory_lock(hashtext(${TEMPLATE_NAME}))`;
    const tag = await tagOf(admin, TEMPLATE_NAME);
    if (ifMissing && tag === templateTag) return;
    if (fresh)
      for (const { datname } of await admin`
        SELECT datname FROM pg_database
        WHERE datname LIKE 'ek\\_t\\_%' AND shobj_description(oid, 'pg_database') = ${TAG}`) {
        const m = TEST_DB_NAME.exec(datname);
        if (m && !alive(Number(m[1]))) await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
      }
    if (tag !== undefined) {
      await admin.unsafe(`ALTER DATABASE "${TEMPLATE_NAME}" IS_TEMPLATE false`);
      await admin.unsafe(`DROP DATABASE "${TEMPLATE_NAME}" WITH (FORCE)`);
    }
    await admin.unsafe(`CREATE DATABASE "${TEMPLATE_NAME}"`);
    const db = postgres(at(adminUrl, TEMPLATE_NAME), { max: 1, onnotice: () => {} });
    try {
      await db.unsafe(schema);
      await db.unsafe(schema);
    } finally {
      await db.end();
    }
    execFileSync('pnpm', ['-s', 'exec', 'tsx', join(FRONTEND, 'scripts', 'programs-sync.mts')], {
      cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, DATABASE_URL: at(adminUrl, TEMPLATE_NAME), EARNKIT_SYNC_NOW: SYNC_NOW },
    });
    // Tagged last: a build that died half way is not a valid template, so the next use rebuilds it.
    await admin.unsafe(`COMMENT ON DATABASE "${TEMPLATE_NAME}" IS '${templateTag}'`);
    await admin.unsafe(`ALTER DATABASE "${TEMPLATE_NAME}" IS_TEMPLATE true`);
  } finally {
    await admin`SELECT pg_advisory_unlock(hashtext(${TEMPLATE_NAME}))`.catch(() => {});
    await admin.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.DATABASE_URL) await buildTemplate(process.env.DATABASE_URL, { fresh: true });
}
