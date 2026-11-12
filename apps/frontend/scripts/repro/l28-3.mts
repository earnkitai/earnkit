// L28-3 (Break): anyone can apply (and be paid) with someone else's repo; nothing compares the signed-in login with the repo.
// Expected (v6.1.16 Task 14): a repo is the builder's only when the signed-in login is the owner, in its org, or among its
// committers; otherwise `This repo is not yours; I apply only with repos you commit to.` and nothing is sent or recorded.
// The seeded repo (lane33/l28-3-timer) lists alice and bob as authors; dave never committed.
import { run, agent, builder, link, call, program, M, appsOf } from './lib.mts';
import { cofounders, send } from './team.mts';
await run('L28-3', 63, async (c) => {
  const g = c.pid('g2'); await program(g, 'Grant Two', M(4000));
  const { proj } = await cofounders(c);
  const D = await builder(`${c.tag}-dave`); const DA = await agent(`${c.tag}-dave`, c.ip(3)); await link(DA, D);
  const f = await call(DA, 'find', { program_id: g, project: proj });
  const s = await call(DA, 'track', { program_id: g, status: 'started', project: proj });
  const t = await send(DA, g, proj);
  const rows = await appsOf([`b:${D.id}`], g);
  const pass = rows.length === 0 && /not yours/i.test(f.sb + s.sb + t.sb);
  return { pass, actual: `dave (no commits) find "${f.sb.split('\n').pop()}"; started "${s.sb}"; sent "${t.sb}"; dave's rows ${rows.map((r: any) => r.status).join(',') || 'none'}` };
});
