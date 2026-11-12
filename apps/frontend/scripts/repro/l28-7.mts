// L28-7 (Break): two record projects on one monorepo: find fills one project's form from the other (Mono API gets Mono Web's live link).
// Expected (v6.1.16 Task 14): a find with no project id on a repo that has two record projects asks `Which project: {a} or {b}?`
// and fills nothing from either; never the other project's value.
import { run, agent, builder, link, call, program, M, F, easy, seedRepo } from './lib.mts';
import { fieldOf } from './fields.mts';
await run('L28-7', 67, async (c) => {
  const g = c.pid('links'); const key = c.repo('mono');
  await program(g, 'Links Grant', { ...M(2500), submission_requirements: [...easy, F('live', 'Live link', 'links', 'the live link', { project_field: 'live_url' })] });
  const Mo = await builder(`${c.tag}-mona`);
  await seedRepo(key, { readme_lead: 'Mono holds two apps.', contributors: [Mo.login] }); const MA = await agent(`${c.tag}-mona`, c.ip(1)); await link(MA, Mo);
  await call(MA, 'record', { set: { person: { name: 'Mona Lane', email: 'mona@example.com' }, projects: [
    { id: 'mono-web', name: 'Mono Web', repo_url: `https://github.com/${key}`, live_url: 'https://web.example.com' },
    { id: 'mono-api', name: 'Mono API', repo_url: `https://github.com/${key}`, live_url: 'https://api.example.com' }] } });
  const r = await call(MA, 'find', { program_id: g, project: { name: 'Mono API', repo_url: `https://github.com/${key}` } });
  const f = fieldOf(r.j, 'live');
  const v = String(f?.value ?? '');
  const asks = /Which project/.test(r.sb);
  return { pass: v !== 'https://web.example.com' && (v === 'https://api.example.com' || asks), actual: `find for Mono API filled Live link with "${v || 'nothing'}" (from ${f?.from ?? '-'}); ${asks ? 'asked which project' : 'did not ask which project'}` };
});
