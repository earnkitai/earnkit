// L24-6 (Break): the passed description becomes an EarnKit value over the field's limit (280 characters in an 80-character
// tagline, from: earnkit) with no cut marker, and the note says "'earnkit' values as given".
// Expected (v6.1.16 Task 11): fitTo cuts an EarnKit value to the field's max and names the cut (fit 'cut' or a fit note).
import { run, agent, program, call, M, F, seedRepo } from './lib.mts';
import { fieldOf } from './fields.mts';
await run('L24-6', 26, async (c) => {
  const t1 = c.pid('t1');
  await program(t1, 'Tagline Grant', { ...M(4000), submission_requirements: [F('project_name', 'Project name', 'name', 'a project name'), F('tagline', 'Tagline', 'one_liner', 'a tagline', { max_chars: 80 })] });
  await seedRepo(c.repo('tlong'), { readme_lead: 'Timer keeps time.' });
  const A = await agent(`${c.tag}-a`, c.ip(1));
  const r = await call(A, 'find', { program_id: t1, project: { name: 'Timer', description: 'A'.repeat(10_000), repo_url: `https://github.com/${c.repo('tlong')}` } });
  const f = fieldOf(r.j, 'tagline');
  if (!f) return { pass: false, actual: `no tagline field in the reply: "${r.sb.slice(0, 160)}"` };
  const len = String(f.value ?? '').length;
  const pass = len <= 80 || f.fit === 'cut';
  return { pass, actual: `tagline (max 80) value length ${len}, from ${f.from}, fit ${f.fit ?? 'none'}` };
});
