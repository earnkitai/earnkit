import postgres from 'postgres';
import { TAG, assertLocalPostgres, TEMPLATE_NAME, TEST_DB_NAME, buildTemplate, tagOf } from './test-db-template.mjs';

const [, , adminUrl, name] = process.argv;
assertLocalPostgres(adminUrl);
if (!TEST_DB_NAME.test(name ?? '')) throw new Error('bad test database name');
// A single-file run (no `pnpm test`) builds the template on first use, or when schema.sql changed.
await buildTemplate(adminUrl, { ifMissing: true });
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
try {
  const tag = await tagOf(admin, name);
  // D13: a same-named database is replaced only when this worktree made it (a reused pid).
  // An untagged one is an orphan (a crash between CREATE and COMMENT): replaced too.
  if (tag && tag !== TAG) throw new Error(`${name} belongs to another test run; not touching it`);
  if (await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`.then((r) => r.length)) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  // FILE_COPY: a plain file copy of the small template; measured ~2s faster per suite than WAL_LOG here.
  await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_NAME}" STRATEGY FILE_COPY`);
  await admin.unsafe(`COMMENT ON DATABASE "${name}" IS '${TAG}'`);
} finally {
  await admin.end();
}
