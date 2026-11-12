// L28-5 (Break): a name-only project merges for good into a later repo project with the same name (its sent application moves).
// Expected (v6.1.16 Task 14): a name-only project never merges into a repo project unless the builder confirms
// (`Is {name} the same as {repo}? Say yes and I join them.`); the sent application keeps its own project key.
import { run, agent, builder, link, call, program, M, appsOf, seedRepo } from './lib.mts';
import { send } from './team.mts';
await run('L28-5', 65, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const Fr = await builder(`${c.tag}-fred`);
  await seedRepo(c.repo('timer2'), { readme_lead: 'A CLI timer.', contributors: [Fr.login] }); const FA = await agent(`${c.tag}-fred`, c.ip(1)); await link(FA, Fr);
  const kitchen = { name: 'Timer', description: 'A kitchen timer app' };
  await call(FA, 'find', { project: kitchen });
  await send(FA, g, kitchen);
  const [before] = await appsOf([`b:${Fr.id}`], g);
  const f = await call(FA, 'find', { project: { name: 'Timer', description: 'A CLI timer', repo_url: `https://github.com/${c.repo('timer2')}` } });
  const [after] = await appsOf([`b:${Fr.id}`], g);
  const asked = f.sb.split('\n').find((l) => /same as/i.test(l)) ?? '';
  return { pass: after?.project_id === before?.project_id, actual: `kitchen Timer's application project ${before?.project_id} became ${after?.project_id} after a find for another Timer with a repo; ${asked ? `asked "${asked}"` : 'nothing asked'}` };
});
