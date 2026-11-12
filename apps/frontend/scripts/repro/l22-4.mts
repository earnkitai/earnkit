// L22-4 (Break): the cap is never checked on a foreign-currency win (`50000 EUR` on a $10,000 program is recorded).
// Expected (v6.1.16 Task 8): refused with the over-cap line (`Over the program's $10,000 cap: ... Nothing recorded for it.`); nothing stored.
import { run, agent, builder, link, program, call, M, appsOf, db } from './lib.mts';
import { addReviewer } from '../../lib/v6/reviewers.ts';
await run('L22-4', 4, async (c) => {
  const scr = c.pid('scr'); await program(scr, 'Capped Grant', M(10000));
  const R = await builder(`${c.tag}-rev`); const RA = await agent(`${c.tag}-rev`, c.ip(9)); await link(RA, R); await addReviewer(scr, R.login, null);
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-b`, c.ip(1)); await link(A, B);
  const proj = { name: 'Cap33', description: 'A small ledger tool' };
  const ap = await call(A, 'track', { program_id: scr, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: proj });
  const q = await call(RA, 'screen', { program_id: scr, applicants: [{ ref: 'f27', name: 'Cap33', application_id: ap.j?.application_id }] });
  const o = await call(RA, 'screen', { job_id: q.j?.job_id, outcomes: [{ ref: 'f27', outcome: 'won', amount: '50000 EUR' }] });
  const so = await db`SELECT outcome, amount_given, currency FROM screen_outcomes WHERE job_id = ${q.j?.job_id}`;
  const [row] = await appsOf([`b:${B.id}`], scr);
  const pass = so.length === 0 && row?.status !== 'won' && /cap/i.test(o.sb + o.note);
  return { pass, actual: `screen "50000 EUR" on a $10,000 cap said "${o.sb}" (note "${o.note.slice(0, 120)}"); screen outcome rows ${so.length} ${JSON.stringify(so[0] ?? null)}; builder row ${row?.status}` };
});
