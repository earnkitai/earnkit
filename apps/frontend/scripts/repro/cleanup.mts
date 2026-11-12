// Lane 33 pack cleanup: removes every row any lane 33 script made (l33- logins, client names and programs, lane33/ repos,
// 10.33.x.x rate windows incl. the 10.33.0.0/16 block windows). Prints one line with what is left.
import { db } from './lib.mts';
import { deleteBuilder } from '../../lib/v6/builders.ts';
import { sql as appSql } from '../../lib/v5/db.ts';
const bids = (await db`SELECT id FROM builders WHERE login LIKE 'l33-%'`).map((r: any) => r.id as number);
for (const b of bids) await deleteBuilder(b, new Date());
const inst = (await db`SELECT id FROM installations WHERE client_name LIKE 'l33-%'`).map((r: any) => r.id as number);
const owners = [...inst.map((i) => `i:${i}`), ...bids.map((b) => `b:${b}`)];
const jobs = (await db`SELECT id FROM screen_jobs WHERE program_id LIKE 'l33-%' OR installation_id = ANY(${inst})`).map((r: any) => r.id);
const n: Record<string, number> = { builders: bids.length };
n.screen_outcomes = (await db`DELETE FROM screen_outcomes WHERE job_id = ANY(${jobs})`).count;
n.screen_applicants = (await db`DELETE FROM screen_applicants WHERE job_id = ANY(${jobs})`).count;
n.screen_jobs = (await db`DELETE FROM screen_jobs WHERE id = ANY(${jobs})`).count;
n.program_reviewers = (await db`DELETE FROM program_reviewers WHERE program_id LIKE 'l33-%' OR builder_id = ANY(${bids})`).count;
n.applications = (await db`DELETE FROM applications WHERE owner = ANY(${owners}) OR program_id LIKE 'l33-%' OR installation_id = ANY(${inst})`).count;
n.application_history = (await db`DELETE FROM application_history WHERE owner = ANY(${owners}) OR program_id LIKE 'l33-%'`).count;
n.gaps_done = (await db`DELETE FROM gaps_done WHERE owner = ANY(${owners}) OR program_id LIKE 'l33-%'`).count;
n.project_reports = (await db`DELETE FROM project_reports WHERE owner = ANY(${owners})`).count;
n.link_codes = (await db`DELETE FROM link_codes WHERE installation_id = ANY(${inst})`).count;
n.installations = (await db`DELETE FROM installations WHERE id = ANY(${inst})`).count;
n.sessions = (await db`DELETE FROM sessions WHERE builder_id = ANY(${bids})`).count;
n.program_changes = (await db`DELETE FROM program_changes WHERE program_id LIKE 'l33-%'`).count;
n.program_health = (await db`DELETE FROM program_health WHERE program_id LIKE 'l33-%'`).count;
n.programs = (await db`DELETE FROM programs WHERE id LIKE 'l33-%'`).count;
n.repo_cache = (await db`DELETE FROM repo_cache WHERE repo LIKE 'lane33/%'`).count;
n.evidence_cache = (await db`DELETE FROM evidence_cache WHERE key LIKE '%lane33/%'`).count;
n.rate_windows = (await db`DELETE FROM rate_windows WHERE key LIKE '%10.33.%' OR key = ANY(${inst.flatMap((i) => [`repoRead:${i}`, `mcp:${i}`])}) OR key = ANY(${bids.map((b) => 'screenJobs:b:' + b)})`).count;
const [left] = await db`SELECT (SELECT count(*)::int FROM programs WHERE id LIKE 'l33-%') programs, (SELECT count(*)::int FROM builders WHERE login LIKE 'l33-%') builders,
  (SELECT count(*)::int FROM installations WHERE client_name LIKE 'l33-%') installations, (SELECT count(*)::int FROM repo_cache WHERE repo LIKE 'lane33/%') repos,
  (SELECT count(*)::int FROM rate_windows WHERE key LIKE '%10.33.%') rate_windows, (SELECT count(*)::int FROM programs WHERE id !~ '^l[0-9]+-') catalog`;
console.log(`cleanup: deleted ${Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'}; left l33 ${JSON.stringify(left)}`);
await db.end({ timeout: 1 }); await appSql().end({ timeout: 1 }).catch(() => {}); process.exit(0);
