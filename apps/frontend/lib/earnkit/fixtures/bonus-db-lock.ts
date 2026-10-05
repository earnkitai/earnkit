import { after, before } from 'node:test';
import type postgres from 'postgres';
import { sql } from '../db';

/**
 * Test only. The bonus ledger's cursor, lease, open sweep and unswept Safe bookings are singletons
 * by design, and `pnpm test` runs test files in parallel: each bonus test file holds this Postgres
 * advisory lock for its whole run, so they never see each other's rows. Ends the pool after.
 */
export function holdBonusDbLock() {
  let conn: postgres.ReservedSql | undefined;
  before(async () => {
    if (!process.env.DATABASE_URL) return;
    conn = await sql().reserve();
    await conn`SELECT pg_advisory_lock(72545)`;
  });
  after(async () => {
    if (!process.env.DATABASE_URL) return;
    if (conn) {
      await conn`SELECT pg_advisory_unlock(72545)`;
      conn.release();
    }
    await sql().end();
  });
}
