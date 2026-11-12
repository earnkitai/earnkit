// L29-8 (Break): started and applied are accepted on a program whose rule is not confirmed when the agent passes no project.
// Expected (v6.1.16 Task 15): the send check uses the installation's last find project when none is passed; an unconfirmed rule
// refuses: `Confirm the rule first: {rule}. Say yes if that is you.` and nothing is written.
import { run, agent, call, program, M, appsOf } from './lib.mts';
await run('L29-8', 88, async (c) => {
  const g = c.pid('rule'); await program(g, 'Ecosystem Fund', { ...M(25000), eligibility: [{ kind: 'rule', note: 'a pre-seed or seed stage startup' }] });
  const A = await agent(`${c.tag}-a`, c.ip(1));
  const f = await call(A, 'find', { program_id: g, project: { name: 'Lane Timer', description: 'Keeps time for teams.' } });
  const s = await call(A, 'track', { program_id: g, status: 'started' });
  const t = await call(A, 'track', { program_id: g, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'] });
  const rows = await appsOf([`i:${A.id}`], g);
  return { pass: rows.length === 0 && /Confirm the rule first/.test(s.sb + t.sb), actual: `find said "${f.sb.split('\n')[0].slice(0, 90)}"; started (no project) "${s.sb}"; applied "${t.sb}"; rows ${rows.map((r: any) => r.status).join(',') || 'none'}` };
});
