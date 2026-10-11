import './env.mts';
import { parseArgs } from 'node:util';
import { sql } from '../lib/earnkit/db';

/**
 * v2.11 success metric (spec "Success metric and its journey test"): the share of no-repo builders
 * whose first session ends with a live project and a ready entry. Shown, never a target: this
 * script prints counts and a share, and sets no goal. Owner-run only, never from predeploy or the
 * cron; read-only (one READ ONLY transaction over installations and builder_events):
 *
 *   pnpm exec tsx apps/frontend/scripts/v211-metric.mts [--as-of <ISO time>]
 *
 * `--as-of` reads the log as it stood then (default: now); a session is over 24 hours after it began.
 *
 * - The cohort: installations that find showed the fresh-build lead (installations.fresh_offer_at,
 *   set once, only for a builder with no fitting repo whose agent can build), minus shared clients
 *   (shared_client), minus installations that never said yes to the build (installations.build is
 *   NULL). A chat-only client is never offered the build when its agent says it can't build; one
 *   whose agent left agent_can_build out (it defaults to true, T7 review M4) still can't start a
 *   build, so the yes is what keeps chat-only clients out. The cost: a coding-agent builder who said
 *   no is left out too; the "shown the lead" line counts them.
 * - The first session: the 24 hours after fresh_offer_at. Installations still inside it are counted
 *   apart and left out of the share.
 * - A second share (final fix M2 b): the same, among builds that reached a repo (build.repo_url).
 * - Shipped: a `deployed`, a `hosted` and an `entered` event of that installation inside the first
 *   session. `entered` is written when the confirm step records the entry, the same reply that
 *   hands over the submit kit, so it stands for "a ready entry and the kit".
 *
 * builder_events has rows only while EARNKIT_EVENT_LOG=on, so a session before the log was on reads
 * as not shipped. Linked installations (installations.builder_id) are not merged: the MCP route
 * acts as the group's root, which is the installation that holds both fresh_offer_at and the events.
 */

const SESSION = '24 hours';

const { values } = parseArgs({ options: { 'as-of': { type: 'string' } } });
const asOf = values['as-of'] === undefined ? new Date() : new Date(values['as-of']);
if (Number.isNaN(asOf.getTime())) {
  console.error('Usage: v211-metric.mts [--as-of <ISO time>]');
  process.exit(2);
}

type Row = { shown: number; started: number; open: number; done: number; shipped: number; repo_done: number; repo_shipped: number; first_event: Date | null };

const db = sql();
try {
  const [r] = await db.begin('read only', (tx) => tx<Row[]>`
    WITH cohort AS (
      SELECT id, fresh_offer_at, build IS NOT NULL AS started, COALESCE(build ? 'repo_url', false) AS made_repo,
             fresh_offer_at + ${SESSION}::interval > ${asOf} AS open
      FROM installations
      WHERE fresh_offer_at IS NOT NULL AND fresh_offer_at <= ${asOf} AND NOT shared_client
    ),
    session AS (
      SELECT c.id,
             bool_or(e.type = 'deployed') AND bool_or(e.type = 'hosted') AND bool_or(e.type = 'entered') AS shipped
      FROM cohort c
      JOIN builder_events e ON e.installation_id = c.id
        AND e.at >= c.fresh_offer_at AND e.at <= c.fresh_offer_at + ${SESSION}::interval
        AND e.type IN ('deployed', 'hosted', 'entered')
      WHERE c.started AND NOT c.open
      GROUP BY c.id
    )
    SELECT
      (SELECT count(*)::int FROM cohort) AS shown,
      (SELECT count(*)::int FROM cohort WHERE started) AS started,
      (SELECT count(*)::int FROM cohort WHERE started AND open) AS open,
      (SELECT count(*)::int FROM cohort WHERE started AND NOT open) AS done,
      (SELECT count(*)::int FROM session WHERE shipped) AS shipped,
      (SELECT count(*)::int FROM cohort WHERE started AND NOT open AND made_repo) AS repo_done,
      (SELECT count(*)::int FROM session s JOIN cohort c ON c.id = s.id WHERE s.shipped AND c.made_repo) AS repo_shipped,
      (SELECT min(at) FROM builder_events WHERE at <= ${asOf}) AS first_event`);
  console.log('v2.11 metric: no-repo builders who shipped in their first session. Shown, never a target.');
  console.log(`Shown the build lead (shared clients left out): ${r.shown}`);
  console.log(`Said yes to the build: ${r.started}`);
  console.log(`Still in their first 24 hours (left out of the share): ${r.open}`);
  console.log(`Shipped in their first 24 hours (deployed, hosted and entered with the submit kit): ${r.shipped}`);
  console.log(
    r.done === 0
      ? 'No no-repo builder has finished a first session yet.'
      : `${r.shipped} of ${r.done} no-repo builders shipped in their first session (${Math.round((100 * r.shipped) / r.done)}%)`,
  );
  // Final fix M2 (b): the same share among builds whose agent got as far as the repo (build.repo_url),
  // an agent that proved it can push; an unmarked chat-only client that said yes never gets there.
  if (r.repo_done > 0)
    console.log(`${r.repo_shipped} of ${r.repo_done} whose agent made the repo shipped in their first session (${Math.round((100 * r.repo_shipped) / r.repo_done)}%)`);
  console.log(r.first_event ? `Event log rows since ${r.first_event.toISOString().slice(0, 10)}.` : 'The event log has no rows (EARNKIT_EVENT_LOG is off, or nothing happened yet).');
} finally {
  await db.end();
}
