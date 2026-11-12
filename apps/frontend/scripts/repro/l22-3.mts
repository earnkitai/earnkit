// L22-3 (Break): a further payment in another currency (or any foreign one) replaces the win instead of adding to it.
// Expected (v6.1.16 Task 8): within one currency payments add (EUR 2,000 + EUR 500 = EUR 2,500); across currencies both are kept
// (EUR 2,000 then $500 reads `$500 and EUR 2,000`); never replaced.
import { run, agent, builder, link, program, call, M, line } from './lib.mts';
import { addReviewer } from '../../lib/v6/reviewers.ts';
await run('L22-3', 3, async (c) => {
  const scr = c.pid('scr'); await program(scr, 'Screened Grant', M(10000));
  const R = await builder(`${c.tag}-rev`); const RA = await agent(`${c.tag}-rev`, c.ip(9)); await link(RA, R); await addReviewer(scr, R.login, null);
  const mk = async (n: string, i: number) => { const B = await builder(`${c.tag}-${n}`); const A = await agent(`${c.tag}-${n}`, c.ip(i)); await link(A, B); const proj = { name: `Pay33${n}`, description: 'A small ledger tool' };
    const ap = await call(A, 'track', { program_id: scr, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: proj }); return { A, proj, id: ap.j?.application_id }; };
  const X = await mk('x', 1); const Y = await mk('y', 2);
  const q = await call(RA, 'screen', { program_id: scr, applicants: [{ ref: 'x', name: 'Pay33x', application_id: X.id }, { ref: 'y', name: 'Pay33y', application_id: Y.id }] });
  const o = (oc: any) => call(RA, 'screen', { job_id: q.j?.job_id, outcomes: [oc] });
  await o({ ref: 'x', outcome: 'won', amount: '2000 EUR' });
  const ox = await o({ ref: 'x', outcome: 'won', amount_usd: 500, payment: { key: 'u2' } });
  await o({ ref: 'y', outcome: 'won', amount: '2000 EUR' });
  await o({ ref: 'y', outcome: 'won', amount: '500 EUR', payment: { key: 'e2' } });
  const lx = line((await call(X.A, 'find', { project: X.proj })).sb, /Your applications/);
  const ly = line((await call(Y.A, 'find', { project: Y.proj })).sb, /Your applications/);
  const pass = /\$500/.test(lx) && /EUR 2,000/.test(lx) && /EUR 2,500/.test(ly);
  return { pass, actual: `EUR 2,000 then $500: screen "${ox.sb}" note "${ox.note.slice(0, 110)}", find "${lx}"; EUR 2,000 then EUR 500: find "${ly}"` };
});
