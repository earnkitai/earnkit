// L23-4 (Break): "I'll ask how it went" lives in one agent note, used up by the first find from any agent.
// Expected (v6.1.16 Task 9): builder text `Results for {title} were due {date}. Did you hear back?` on every find until an
// outcome is recorded, at most once a day per installation; so agent 1 and agent 2 each show it.
import { run, agent, builder, link, program, call, M, iso } from './lib.mts';
await run('L23-4', 14, async (c) => {
  const g = c.pid('ak'); await program(g, 'Ask Grant', { ...M(3900), ends_at: iso(30), results_due: { date: iso(-1).slice(0, 10) } });
  const B = await builder(`${c.tag}-b`);
  const R1 = await agent(`${c.tag}-r1`, c.ip(1)); await link(R1, B);
  const R2 = await agent(`${c.tag}-r2`, c.ip(2)); await link(R2, B);
  const proj = { name: 'Lane Timer', description: 'Keeps time for teams.' };
  await call(R1, 'track', { program_id: g, status: 'applied', submitted_by: 'builder', fields_used: ['project_name', 'email'], project: proj });
  const f1 = await call(R1, 'find', { project: proj });
  const f2 = await call(R2, 'find', { project: proj });
  const ask = (s: string) => s.split('\n').find((l) => /L33 Ask Grant/.test(l) && /hear back|how it went|go\?/i.test(l)) ?? '';
  const a1 = ask(f1.sb), a2 = ask(f2.sb);
  return { pass: a1 !== '' && a2 !== '', actual: `results due yesterday: agent 1 builder text ${a1 ? `"${a1}"` : 'has no results question'} (note ${/Ask once how each went/.test(f1.note) ? 'asks' : 'silent'}); agent 2 builder text ${a2 ? `"${a2}"` : 'has no results question'} (note ${/Ask once how each went/.test(f2.note) ? 'asks' : 'silent'})` };
});
