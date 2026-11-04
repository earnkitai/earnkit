import postgres from 'postgres';
import { TAG, assertLocalPostgres, TEST_DB_NAME, tagOf } from './test-db-template.mjs';

const [, , adminUrl, name] = process.argv;
assertLocalPostgres(adminUrl);
if (TEST_DB_NAME.test(name ?? '')) {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    // only a database this worktree made.
    if ((await tagOf(admin, name)) === TAG) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
