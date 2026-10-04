import postgres from 'postgres';

const globalForDb = globalThis as unknown as { earnkitSql?: postgres.Sql };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, { max: 5, onnotice: () => {} });
}

/** The pool or one transaction's connection: what read helpers that can run in a transaction take. */
export type Db = postgres.Sql | postgres.TransactionSql;

/** One shared connection pool (survives Next.js dev reloads). */
export function sql() {
  globalForDb.earnkitSql ??= connect();
  return globalForDb.earnkitSql;
}
