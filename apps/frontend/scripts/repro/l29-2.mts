// L29-2 (Break): a find with no project (or name only) hides the applications line and dumps the catalog.
// Expected (v6.1.16 Task 15): the applications line shows whenever the installation is linked, project or not; the ask for the
// project is one line.
import { run, agent, builder, link, call, program, M, line } from './lib.mts';
import { send } from './team.mts';
await run('L29-2', 82, async (c) => {
  const g1 = c.pid('g1'); await program(g1, 'Builder Grant', M(6000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  await send(A, g1, { name: 'Lane Timer', description: 'Keeps time for teams.' });
  const f0 = await call(A, 'find', {});
  const f1 = await call(A, 'find', { project: { name: 'Timer' } });
  const l0 = line(f0.sb, /Your applications/), l1 = line(f1.sb, /Your applications/);
  return { pass: l0 !== '' && l1 !== '', actual: `find {} ${l0 ? `"${l0}"` : `has no applications line ("${f0.sb.split('\n')[0].slice(0, 90)}")`}; find name-only ${l1 ? `"${l1}"` : `has no applications line ("${f1.sb.split('\n').pop()!.slice(0, 90)}")`}` };
});
