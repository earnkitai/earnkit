// L22-1 (Break): an EUR win counts as a win but its money drops out of every total.
// Expected (v6.1.16 Task 8): find reads `2 won ($1,000 and EUR 2,000)`; /api/stats (readStats) keeps won_usd USD only and adds won_other with EUR 2000.
import { run, agent, builder, link, program, call, M, line } from './lib.mts';
import { addReviewer } from '../../lib/v6/reviewers.ts';
import { readStats } from '../../lib/v5/stats.ts';
await run('L22-1', 1, async (c) => {
  const g1 = c.pid('g1'), scr = c.pid('scr');
  await program(g1, 'Alpha Grant', M(10000)); await program(scr, 'Screened Grant', M(10000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  const R = await builder(`${c.tag}-rev`); const RA = await agent(`${c.tag}-rev`, c.ip(2)); await link(RA, R); await addReviewer(scr, R.login, null);
  const proj = { name: 'Ledger33', description: 'A small ledger tool' };
  await call(A, 'find', { project: proj });
  await call(A, 'track', { program_id: g1, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: proj });
  await call(A, 'track', { program_id: g1, status: 'won', amount_usd: 1000, project: proj });
  const ap = await call(A, 'track', { program_id: scr, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: proj });
  const before = await readStats(new Date());
  const q = await call(RA, 'screen', { program_id: scr, applicants: [{ ref: 'x', name: 'Ledger33', application_id: ap.j?.application_id }] });
  const o = await call(RA, 'screen', { job_id: q.j?.job_id, outcomes: [{ ref: 'x', outcome: 'won', amount: '2000 EUR' }] });
  const f = await call(A, 'find', { project: proj });
  const l = line(f.sb, /Your applications/);
  const after: any = await readStats(new Date());
  const other = JSON.stringify(after.won_other ?? null);
  const okFind = /EUR 2,000/.test(l) && /\$1,000/.test(l);
  const okStats = /EUR/.test(other) && /2000/.test(other) && Number(after.won_usd) - Number((before as any).won_usd) === 0;
  return { pass: okFind && okStats, actual: `find "${l}"; stats won_other ${other}, won_usd +${Number(after.won_usd) - Number((before as any).won_usd)} after the EUR win; screen said "${o.sb}"` };
});
