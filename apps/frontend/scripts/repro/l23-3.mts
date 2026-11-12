// L23-3 (Break): agent 1's claim lapsed, agent 2 took it over, agent 1 then reports its real send and is refused.
// Expected (v6.1.16 Task 9): `applied` is a report of a send that happened: never refused, never lost. It is recorded and the
// note says `Recorded. Another agent had started this one too; tell the builder so it is not sent twice.`
import { run, agent, builder, link, program, call, M, appsOf, db } from './lib.mts';
await run('L23-3', 13, async (c) => {
  const g = c.pid('g4'); await program(g, 'Grant Four', M(3000));
  const B = await builder(`${c.tag}-b`);
  const R1 = await agent(`${c.tag}-r1`, c.ip(1)); await link(R1, B);
  const R2 = await agent(`${c.tag}-r2`, c.ip(2)); await link(R2, B);
  const proj = { name: 'Lane Timer', description: 'Keeps time for teams.' };
  await call(R1, 'find', { project: proj });
  await call(R1, 'track', { program_id: g, status: 'started', project: proj });
  await db`UPDATE applications SET claimed_at = claimed_at - interval '30 hours', at = at - interval '30 hours' WHERE owner = ${'b:' + B.id} AND program_id = ${g}`;
  await call(R2, 'find', { project: proj });
  const t2 = await call(R2, 'track', { program_id: g, status: 'started', project: proj });
  const t1 = await call(R1, 'track', { program_id: g, status: 'applied', submitted_by: 'agent', fields_used: ['project_name', 'email'], project: proj });
  const [row] = await appsOf([`b:${B.id}`], g);
  const pass = row?.status === 'applied' && !/nothing recorded/i.test(t1.sb + t1.note) && /another agent/i.test(t1.sb + t1.note);
  return { pass, actual: `agent 2 took over ("${t2.sb}"); agent 1's real send got "${t1.sb}" (note "${t1.note.slice(0, 100)}"); row now ${row?.status}` };
});
