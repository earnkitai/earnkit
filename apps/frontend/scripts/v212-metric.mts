import './env.mts';
import { parseArgs } from 'node:util';
import { sql } from '../lib/earnkit/db';

/**
 * v2.12 spec 3: the empty-profile rate for new installs, per day. Shown, never a target (the spec
 * expects under 10%; nothing here sets a goal). Owner-run only, never from predeploy or the cron;
 * read-only (one READ ONLY transaction over builder_profiles and builder_events):
 *
 *   pnpm exec tsx apps/frontend/scripts/v212-metric.mts [--as-of <ISO time>] [--days 14]
 *
 * - New: a profile whose first find (builder_profiles.first_find_at) fell on that UTC day, within
 *   the `--days` before `--as-of` (default: the last 14 days up to now). A profile is a person (the
 *   installation group's root, plan R1); shared clients never get one (R2), so they are left out.
 * - Empty: it has a profile_empty event (dedupe key profile_empty:<builder_id>), which the cron writes
 *   once, 10 or more minutes after the first find, when no verified outcome scored above 0. A profile
 *   made in the last 10 minutes, or before the next cron run, is not checked yet and reads as filled.
 * - builder_events has rows only while EARNKIT_EVENT_LOG=on, so a day before the log was on reads as 0 empty.
 */
const { values } = parseArgs({ options: { 'as-of': { type: 'string' }, days: { type: 'string' } } });
const asOf = values['as-of'] ? new Date(values['as-of']) : new Date();
const days = Number(values.days ?? 14);
if (Number.isNaN(asOf.getTime()) || !Number.isInteger(days) || days < 1) {
  console.error('Usage: v212-metric.mts [--as-of <ISO time>] [--days <n>]');
  process.exit(2);
}
const db = sql();
try {
  const rows = await db.begin('read only', (tx) => tx<{ day: string; made: number; empty: number }[]>`
    SELECT (p.first_find_at AT TIME ZONE 'UTC')::date::text AS day, count(*)::int AS made,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM builder_events e WHERE e.dedupe_key = 'profile_empty:' || p.builder_id))::int AS empty
    FROM builder_profiles p
    WHERE p.first_find_at <= ${asOf} AND p.first_find_at > ${new Date(asOf.getTime() - days * 86_400_000)}
    GROUP BY 1 ORDER BY 1`);
  console.log('v2.12 metric: new profiles per day and how many were empty 10 minutes after their first find. Shown, never a target.');
  for (const r of rows) console.log(`${r.day}: ${r.made} new, ${r.empty} empty (${r.made ? Math.round((100 * r.empty) / r.made) : 0}%)`);
  if (rows.length === 0) console.log('No new profiles in the window.');
} finally {
  await db.end();
}
