// L29-11 (Break): the record get the instructions require (linked, after find) starts a 20-item intake
// (`Your record is missing: ... and 17 more.` with the note `Ask the builder once, all together, for what missing lists`).
// Expected (v6.1.16 Task 15): the record note after a find asks for at most the two items the next send needs; never the whole list.
import { run, agent, builder, link, call, program, M } from './lib.mts';
await run('L29-11', 91, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  await call(A, 'find', { project: { name: 'Lane Timer', description: 'Keeps time for teams.' } });
  const r = await call(A, 'record', { get: true });
  const more = /and \d+ more/.test(r.sb);
  const all = /all together/.test(r.note);
  const listed = Array.isArray(r.j?.missing) ? r.j.missing.length : null;
  return { pass: !more && !all && (listed === null || listed <= 2), actual: `record get after find: "${r.sb.slice(0, 140)}"; note ${all ? 'asks for the whole list all together' : 'clean'}; missing list ${listed ?? 'n/a'}` };
});
