// L24-2 (Break): a yes to a question ("Do real people use it?") becomes permission to submit; the rule note says
// "submit it without asking again".
// Expected (v6.1.16 Task 11): after a question's yes the next reply makes the apply offer afresh (no `Your yes stands ... I apply now.`);
// notes never say `submit without asking again`; the rule note reads `Draft it and show the builder; submit only on a yes to the draft.`
import { run, agent, program, call, M, seedRepo } from './lib.mts';
await run('L24-2', 22, async (c) => {
  const us = c.pid('us'), rule = c.pid('rule');
  await program(us, 'Users Grant', { ...M(6500), eligibility: [{ kind: 'users' }] });
  await program(rule, 'Rule Grant', { ...M(6000), eligibility: [{ kind: 'rule', note: 'a first-time founder' }] });
  await seedRepo(c.repo('rl'), { readme_lead: 'Lane Timer keeps time.' });
  const A = await agent(`${c.tag}-a`, c.ip(1));
  const proj = { name: 'Lane Timer', description: 'Keeps time for teams; first-time founder.', repo_url: `https://github.com/${c.repo('rl')}` };
  const q = await call(A, 'find', { program_id: us, project: proj });
  const gd = await call(A, 'track', { program_id: us, status: 'gap_done', item: 'users', project: proj });
  const again = await call(A, 'find', { program_id: us, project: proj });
  const r = await call(A, 'find', { program_id: rule, project: proj });
  const stands = /Your yes stands/.test(again.sb);
  const noteBad = /without asking again/.test(r.note + again.note);
  // v6.1.16 Task 11 N5: the precondition follows the one-program users text, not a `?`; v6.1.18 L38-4: `...: real users.`.
  const asked = /: real users\./.test(q.sb);
  return { pass: asked && /say yes|apply/i.test(again.sb) && !stands && !noteBad, actual: `${asked ? '' : 'users question not asked; '}question "${q.sb.split('\n').pop()}", yes recorded "${gd.sb}"; next reply "${again.sb.replace(/\n/g, ' ')}"; rule note ${noteBad ? 'says "draft and submit it without asking again"' : 'clean'}` };
});
