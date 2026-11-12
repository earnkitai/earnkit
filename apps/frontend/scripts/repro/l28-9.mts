// L28-9 (Break): contact fields take the builder's name for a username and the builder's email for a co-founder's.
// Expected (v6.1.16 Task 14): a username or handle field is never filled from a name (a GitHub username is the linked login,
// Telegram stays the builder's to give); a second founder's email comes from that member in the record team, or is asked.
import { run, agent, builder, link, call, program, M, F, easy } from './lib.mts';
import { fieldOf } from './fields.mts';
await run('L28-9', 69, async (c) => {
  const g = c.pid('contact');
  await program(g, 'Contact Grant', { ...M(5000), submission_requirements: [...easy, F('telegram', 'Your Telegram username', 'contact', 'your telegram username'), F('gh_user', 'Proposer (GitHub username)', 'contact', 'your github username'), F('cofounder_email', 'Email (2nd founder)', 'contact', 'the second founder email', { type: 'email' })] });
  const Ts = await builder(`${c.tag}-tess`); const TA = await agent(`${c.tag}-tess`, c.ip(1)); await link(TA, Ts);
  await call(TA, 'record', { set: { person: { name: 'Tess Lane', email: 'tess@example.com' }, team: [{ name: 'Tess Lane', role: 'CEO' }, { name: 'Uma Lane', role: 'CTO', email: 'uma@example.com' }], projects: [{ id: 'teamapp', name: 'Teamapp' }] } });
  const r = await call(TA, 'find', { program_id: g, project: { name: 'Teamapp', description: 'Helps teams plan.' } });
  const v = (k: string) => String(fieldOf(r.j, k)?.value ?? '');
  const bad = [['telegram', v('telegram'), v('telegram') === 'Tess Lane'], ['gh_user', v('gh_user'), v('gh_user') === 'Tess Lane'], ['cofounder_email', v('cofounder_email'), v('cofounder_email') === 'tess@example.com']].filter((x) => x[2]);
  return { pass: bad.length === 0, actual: `Telegram username "${v('telegram')}", GitHub username "${v('gh_user')}", 2nd founder email "${v('cofounder_email')}" (builder is Tess Lane, tess@example.com; Uma's is uma@example.com)` };
});
