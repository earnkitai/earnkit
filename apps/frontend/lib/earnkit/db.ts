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

/**
 * v2.13.4: side effects that must wait for a caller's transaction to COMMIT (cache invalidation, events
 * written on another connection). A caller that runs writes in its own transaction registers it with
 * `deferUntilCommit`; helpers then call `afterCommit(db, fn)`, which queues `fn` on that transaction (run
 * by the caller after its commit, dropped on rollback) or runs it at once when `db` is not one.
 */
const deferred = new WeakMap<object, (() => unknown)[]>();
export async function withDeferred<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let queue: (() => unknown)[] = [];
  const out = await sql().begin(async (tx) => {
    queue = [];
    deferred.set(tx, queue);
    return fn(tx);
  });
  // Committed: now the deferred effects, each on its own (a failing one never undoes the commit).
  for (const f of queue) await Promise.resolve().then(f).catch((err: unknown) => console.error('[db] after commit', err instanceof Error ? err.name : 'error'));
  return out as T;
}
export function afterCommit(db: Db | undefined, fn: () => unknown): unknown {
  const queue = db ? deferred.get(db) : undefined;
  if (queue) {
    queue.push(fn);
    return undefined;
  }
  return fn();
}

/** One shared connection pool (survives Next.js dev reloads). */
export function sql() {
  globalForDb.earnkitSql ??= connect();
  return globalForDb.earnkitSql;
}
