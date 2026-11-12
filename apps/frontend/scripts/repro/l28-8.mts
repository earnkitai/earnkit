// L28-8 (Break): every team-kind text field gets the joined list of team names (a count, a yes/no, a role question alike).
// Expected (v6.1.16 Task 14): each team question reads its own fact: the names only where names are asked; a count gets the
// number (or `Needs your answer.`); never the names list in a count, full-time or role field.
import { run, agent, builder, link, call, program, M, F, easy } from './lib.mts';
import { fieldOf } from './fields.mts';
await run('L28-8', 68, async (c) => {
  const g = c.pid('team');
  const T = (key: string, label: string) => F(key, label, 'team', label.toLowerCase().replace(/[?:]/g, ''), { from: 'builder' });
  await program(g, 'Team Fund', { ...M(25000), submission_requirements: [...easy, T('founding_team', 'Founding team: names and roles'), T('founders_count', 'Number of founders'), T('full_time', 'Are you all working full-time on this?'), T('core_size', 'How large is the core team?'), T('role', 'What is your role in the project?')] });
  const Ts = await builder(`${c.tag}-tess`); const TA = await agent(`${c.tag}-tess`, c.ip(1)); await link(TA, Ts);
  await call(TA, 'record', { set: { person: { name: 'Tess Lane', email: 'tess@example.com' }, team: [{ name: 'Tess Lane', role: 'CEO' }, { name: 'Uma Lane', role: 'CTO', email: 'uma@example.com' }], projects: [{ id: 'teamapp', name: 'Teamapp' }] } });
  const r = await call(TA, 'find', { program_id: g, project: { name: 'Teamapp', description: 'Helps teams plan.' } });
  const wrong = ['founders_count', 'full_time', 'core_size', 'role'].map((k) => [k, String(fieldOf(r.j, k)?.value ?? '')]).filter(([, v]) => /Tess Lane/.test(v));
  return { pass: wrong.length === 0, actual: `${wrong.length} of 4 non-name team fields filled with the names list (${wrong.map(([k, v]) => `${k}="${v}"`).join('; ')}); names field "${fieldOf(r.j, 'founding_team')?.value ?? ''}"` };
});
