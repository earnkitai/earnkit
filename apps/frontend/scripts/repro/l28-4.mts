// L28-4 (Break): applications are unique per (builder, program), so a builder's second project can never apply to a program.
// Expected (v6.1.16 Task 14): the application key is (builder, program, project key); a second, different project applies;
// the already-sent line, when it shows, names the project (`{title} was already sent for {project}.`).
import { run, agent, builder, link, call, program, M, appsOf, seedRepo } from './lib.mts';
import { send } from './team.mts';
await run('L28-4', 64, async (c) => {
  const g = c.pid('g3'); await program(g, 'Grant Three', M(3500));
  const C = await builder(`${c.tag}-carol`);
  await seedRepo(c.repo('app'), { readme_lead: 'App does a thing.', contributors: [C.login] }); await seedRepo(c.repo('clock'), { readme_lead: 'Clock tells time.', contributors: [C.login] }); const CA = await agent(`${c.tag}-carol`, c.ip(1)); await link(CA, C);
  const app = { name: 'App', description: 'An app', repo_url: `https://github.com/${c.repo('app')}` };
  const clock = { name: 'Clock', description: 'A different product: a clock', repo_url: `https://github.com/${c.repo('clock')}` };
  await send(CA, g, app);
  const s = await call(CA, 'track', { program_id: g, status: 'started', project: clock });
  const t = await send(CA, g, clock);
  const rows = await appsOf([`b:${C.id}`], g);
  const projects = new Set(rows.map((r: any) => r.project_id));
  return { pass: rows.length === 2 && projects.size === 2, actual: `App sent; Clock (another repo) started "${s.sb}", sent "${t.sb}"; carol's rows for the program: ${rows.length} (${[...projects].join(', ')})` };
});
