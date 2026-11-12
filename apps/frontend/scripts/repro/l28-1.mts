// L28-1 (Break): two co-founders on one repo both send the same program and nobody is told.
// Expected (v6.1.16 Task 14): one application per repo key per program across builders; the second builder hears
// `Already sent for this repo on {date} by {login}.` and nothing is written.
import { run, call, program, M, appsOf } from './lib.mts';
import { cofounders, send } from './team.mts';
await run('L28-1', 61, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const { Bb, AA, BA, proj } = await cofounders(c);
  await call(AA, 'track', { program_id: g, status: 'started', project: proj });
  await send(AA, g, proj);
  const f = await call(BA, 'find', { program_id: g, project: proj });
  const s = await call(BA, 'track', { program_id: g, status: 'started', project: proj });
  const t = await send(BA, g, proj);
  const bob = await appsOf([`b:${Bb.id}`], g);
  const pass = bob.length === 0 && /Already sent for this repo/.test(t.sb + s.sb);
  return { pass, actual: `alice sent; bob's find "${f.sb.split('\n').pop()}", bob started "${s.sb}", bob sent "${t.sb}"; bob's rows ${bob.map((r: any) => r.status).join(',') || 'none'}` };
});
