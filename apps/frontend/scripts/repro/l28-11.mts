// L28-11 (Break): the screen gives two co-founders' applications for one repo different results (won for one, rejected for the
// other); the second ledger is wrong for good.
// Expected (v6.1.16 Task 14, with L28-1): a screen result is keyed to the repo's application, so co-founders share one result.
// Pass when, after the reviewer's outcomes, the repo's rows on this program carry at most one result.
import { run, agent, builder, link, call, program, M, appsOf } from './lib.mts';
import { addReviewer } from '../../lib/v6/reviewers.ts';
import { cofounders, send } from './team.mts';
await run('L28-11', 71, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const { A, Bb, AA, BA, proj } = await cofounders(c);
  const R = await builder(`${c.tag}-rev`); const RA = await agent(`${c.tag}-rev`, c.ip(3)); await link(RA, R); await addReviewer(g, R.login, null);
  const a = await send(AA, g, proj); const b = await send(BA, g, proj);
  const list = [{ ref: 'r-alice', name: 'Timer', repo_url: proj.repo_url, application_id: a.j?.application_id }, { ref: 'r-bob', name: 'Timer', repo_url: proj.repo_url + '.git', application_id: b.j?.application_id }].filter((x) => x.application_id);
  const q = await call(RA, 'screen', { program_id: g, applicants: list });
  const o = await call(RA, 'screen', { job_id: q.j?.job_id, outcomes: [{ ref: 'r-alice', outcome: 'won', amount_usd: 3000 }, ...(list.length > 1 ? [{ ref: 'r-bob', outcome: 'rejected' }] : [])] });
  const rows = await appsOf([`b:${A.id}`, `b:${Bb.id}`], g);
  const results = new Set(rows.map((r: any) => r.status).filter((s: string) => s !== 'applied'));
  const statuses = rows.map((r: any) => `${r.owner === 'b:' + A.id ? 'alice' : 'bob'} ${r.status}`).join(', ');
  return { pass: results.size <= 1 && !(rows.some((r: any) => r.status === 'rejected') && rows.some((r: any) => r.status === 'won')), actual: `screen of one repo: "${o.sb}"; rows ${statuses}` };
});
