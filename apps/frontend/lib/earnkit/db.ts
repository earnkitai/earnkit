import postgres from 'postgres';

const globalForDb = globalThis as unknown as { earnkitSql?: postgres.Sql };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, { max: 5, onnotice: () => {} });
}

/** The pool or one transaction's connection: what read helpers that can run in a transaction take. */
export type Db = postgres.Sql | postgres.TransactionSql;

/**
 * v2.13.4: run `fn` in the caller's transaction (a savepoint) when `db` is one, else in a new transaction,
 * so a caller holding a lock can run these writes on its own connection (no second pooled connection).
 */
export function inTx<T>(db: Db | undefined, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  if (db && typeof (db as postgres.TransactionSql).savepoint === 'function') return (db as postgres.TransactionSql).savepoint(fn) as Promise<T>;
  return sql().begin(fn) as Promise<T>;
}

/** One shared connection pool (survives Next.js dev reloads). */
export function sql() {
  globalForDb.earnkitSql ??= connect();
  return globalForDb.earnkitSql;
}
