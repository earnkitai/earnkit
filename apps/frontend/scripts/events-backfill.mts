import './env.mts';
import { sql } from '../lib/earnkit/db';
import { EVENT_LOG_FLAG, eventLogEnabled } from '../lib/earnkit/events';
import { backfillEvents } from '../lib/earnkit/events-backfill';

/**
 * v2.11 T3: writes the builder events from before the log was on (lib/earnkit/events-backfill.ts).
 * One-off and owner-run only, never from predeploy or the cron:
 *
 *   EARNKIT_EVENT_LOG=on pnpm exec tsx apps/frontend/scripts/events-backfill.mts
 *
 * Run it only once the /terms "What EarnKit records" section is live (T12), like the flag itself.
 * Idempotent: each event's dedupe_key is the live step's, so a rerun writes 0. Prints counts only.
 */
if (!eventLogEnabled()) {
  console.error(`${EVENT_LOG_FLAG} is not on: nothing written. Set ${EVENT_LOG_FLAG}=on once /terms discloses the log.`);
  process.exit(1);
}
const db = sql();
try {
  const counts = await backfillEvents(db);
  for (const [type, c] of Object.entries(counts)) console.log(`${type}: ${c.seen} seen, ${c.written} written`);
} finally {
  await db.end();
}
