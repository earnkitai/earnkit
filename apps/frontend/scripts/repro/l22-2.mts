// L22-2 (Break): track has no currency, so a builder's own agent can record a EUR win only as dollars.
// Expected (v6.1.16 Task 8, L22-2 + L29-25): track takes `amount` with `currency`; `won 2000 EUR` reads `Won EUR 2,000.` and is stored as EUR, never $2,000.
import { run, agent, builder, link, program, call, M, line, appsOf } from './lib.mts';
await run('L22-2', 2, async (c) => {
  const g = c.pid('g1'); await program(g, 'Euro Grant', M(10000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  const proj = { name: 'Euro33', description: 'A small ledger tool' };
  await call(A, 'track', { program_id: g, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: proj });
  const w = await call(A, 'track', { program_id: g, status: 'won', amount: 2000, currency: 'EUR', project: proj });
  const f = await call(A, 'find', { project: proj });
  const l = line(f.sb, /Your applications/);
  const [row] = await appsOf([`b:${B.id}`], g);
  const pass = /EUR 2,000/.test(w.sb) && !/\$2,000/.test(w.sb) && /EUR 2,000/.test(l) && row?.status === 'won';
  return { pass, actual: `track won amount 2000 currency EUR said "${w.sb}" (note "${w.note.slice(0, 120)}"); stored ${row?.status} ${row?.amount_usd ?? 'no amount'}; find "${l}"` };
});
