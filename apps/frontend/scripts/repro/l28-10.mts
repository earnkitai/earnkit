// L28-10 (Break): after the builder unlinks an agent it re-sends what the builder already sent (a second application from one person).
// Expected (v6.1.16 Task 14): the ledger survives unlink; the unlinked agent's find shows the earlier send, and a second send is
// refused with `Already sent on {date}.` (nothing written).
import { run, agent, builder, link, call, program, M, appsOf, mePost } from './lib.mts';
import { send } from './team.mts';
await run('L28-10', 70, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const E = await builder(`${c.tag}-eve`); const EA = await agent(`${c.tag}-eve`, c.ip(1)); await link(EA, E);
  const proj = { name: 'Eve App', description: 'Helps eve.' };
  await send(EA, g, proj);
  const u = await mePost(E, '/me/unlink', { installation_id: String(EA.id) });
  if (u.status !== 303) return { pass: false, actual: `setup: unlink on /me answered ${u.status}` };
  const f = await call(EA, 'find', { program_id: g, project: proj });
  const t = await send(EA, g, proj);
  const rows = await appsOf([`i:${EA.id}`], g);
  const pass = rows.length === 0 && /Already sent/.test(t.sb + t.note);
  return { pass, actual: `after unlink the agent's find says "${f.sb.split('\n').pop()}"; its second send got "${t.sb}"; new rows on the unlinked agent: ${rows.length}` };
});
