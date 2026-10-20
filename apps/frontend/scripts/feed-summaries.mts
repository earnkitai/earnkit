import './env.mts';
import { sql } from '../lib/earnkit/db';
import { weekTitles } from '../lib/earnkit/week-facts';

/**
 * Weekly updates: pnpm feed:summaries [--dry]. Owner-run once after the deploy (and again after ANTHROPIC_API_KEY is
 * set, with --redo): writes the summary of every week that shipped code and has none, from the week's titles read
 * again through the GitHub App (week-facts.ts weekTitles, the weekly job's own read and privacy rule).
 * --redo also rewrites the ones already stored.
 */
const dry = process.argv.includes('--dry');
const redo = process.argv.includes('--redo');
const rows = await sql()<{ id: number; builder_id: number; key: string; week: string }[]>`
  SELECT id::int AS id, builder_id::int AS builder_id, project_key AS key, week::text AS week FROM project_updates
  WHERE facts ? 'shipped_code' ${redo ? sql`` : sql`AND summary IS NULL`} ORDER BY week DESC`;
let wrote = 0;
for (const r of rows) {
  const work = await weekTitles(r.builder_id, r.key, r.week, new Date(), fetch).catch((err: unknown) => {
    console.error(`update ${r.id}: ${err instanceof Error ? err.name : 'error'}`);
    return null;
  });
  if (!work?.summary) {
    console.log(`update ${r.id} (${r.week}): no summary`);
    continue;
  }
  console.log(`update ${r.id} (${r.week}): ${work.summary}`);
  if (!dry) {
    await sql()`UPDATE project_updates SET summary = ${work.summary} WHERE id = ${r.id}`;
    wrote++;
  }
}
console.log(`${dry ? 'Dry run: ' : ''}${wrote} of ${rows.length} written.`);
await sql().end();
