// L24-3 (Break): track's program lookup matches common words (`next`, `start`, `build`, `first`) to catalog programs and writes.
// Expected (v6.1.16 Task 11): a common word alone never names a program: `Which program? Say its name.` and nothing written.
import { run, agent, call, appsOf } from './lib.mts';
await run('L24-3', 23, async (c) => {
  const A = await agent(`${c.tag}-a`, c.ip(1));
  const proj = { name: 'Lane Timer', description: 'Keeps time for teams.' };
  const out: string[] = [];
  for (const [w, s] of [['next', 'applied'], ['start', 'applied'], ['build', 'rejected'], ['first', 'started']] as const) {
    const r = await call(A, 'track', { program_id: w, status: s, ...(s === 'applied' ? { submitted_by: 'agent', fields_used: ['project_name'] } : {}), project: proj });
    out.push(`${w}: "${r.sb.slice(0, 70)}"`);
  }
  const rows = await appsOf([`i:${A.id}`]);
  return { pass: rows.length === 0, actual: `${rows.length} rows written (${rows.map((r: any) => `${r.program_id}:${r.status}`).join(', ')}); ${out.join('; ')}` };
});
