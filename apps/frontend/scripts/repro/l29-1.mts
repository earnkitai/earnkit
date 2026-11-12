// L29-1 (Break): nothing lists the builder's applications by name (only counts: `3 sent, 3 waiting.`).
// Expected (v6.1.16 Task 15): find's applications line names them: `Your applications: L33 Builder Grant (sent Nov 11, waiting), ...`
// up to five, then `and {n} more.`; the JSON carries the full list (program id, title, status, dates, amount).
import { run, agent, builder, link, call, program, M, line } from './lib.mts';
import { send } from './team.mts';
await run('L29-1', 81, async (c) => {
  const g1 = c.pid('g1'), g2 = c.pid('g2');
  await program(g1, 'Builder Grant', M(6000)); await program(g2, 'Starter Grant', M(5000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  const proj = { name: 'Lane Timer', description: 'Keeps time for teams.' };
  await send(A, g1, proj); await send(A, g2, proj);
  const f = await call(A, 'find', { project: proj });
  const l = line(f.sb, /Your applications/);
  const json = JSON.stringify(f.j?.applications ?? null);
  const pass = /L33 Builder Grant/.test(l) && /L33 Starter Grant/.test(l) && json.includes(g1) && json.includes(g2);
  return { pass, actual: `applications line "${l}"; ledger JSON ${json.slice(0, 160)}` };
});
