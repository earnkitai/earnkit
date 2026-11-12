// L29-7 (Break): in-person programs sit in the JSON `ready` list and `track applied` from an agent accepts them.
// Expected (v6.1.16 Task 15): the JSON separates `ready` (agent may send) from `in_person` and `you_send`; an agent's
// `track applied` on an in-person program is refused: `{title} is applied for in person; nothing to send.`
import { run, agent, call, program, M, appsOf } from './lib.mts';
await run('L29-7', 87, async (c) => {
  const ip = c.pid('ip'); await program(ip, 'Demo Day', { ...M(20000), in_person: true });
  const A = await agent(`${c.tag}-a`, c.ip(1));
  const proj = { name: 'Lane Timer', description: 'Keeps time for teams.' };
  const f = await call(A, 'find', { project: proj, filter: { all: true } });
  const ready = (f.j?.ready ?? []) as any[];
  const inReady = ready.filter((r) => r.in_person === true).map((r) => r.program_id);
  await call(A, 'track', { program_id: ip, status: 'started', project: proj });
  const t = await call(A, 'track', { program_id: ip, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: proj });
  const rows = (await appsOf([`i:${A.id}`], ip)).filter((r: any) => r.status === 'applied');
  return { pass: inReady.length === 0 && rows.length === 0, actual: `JSON ready holds ${inReady.length} in-person programs (${inReady.slice(0, 4).join(', ')}); agent's applied on in-person L33 Demo Day said "${t.sb}", applied rows ${rows.length}` };
});
