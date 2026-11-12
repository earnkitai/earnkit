// L23-2 (+ L23-10) (Break): a program past its close reads open until the daily run, then its guide is a 404.
// Expected (v6.1.16 Task 9): open/closed derived from closes_at at read time (isOpenAt); the guide renders 200 with
// `Closed on {date}.` and no Apply link; find does not offer it.
import { run, agent, program, call, M, db, O } from './lib.mts';
await run('L23-2', 12, async (c) => {
  const id = c.pid(`c-${c.nonce}`); await program(id, 'Closed Grant', M(3500));
  const past = new Date(Date.now() - 2 * 3600_000).toISOString();
  await db`UPDATE programs SET ends_at = ${past}, file = jsonb_set(file, '{ends_at}', ${db.json(past)}) WHERE id = ${id}`;
  const g = await fetch(`${O}/programs/${id}`, { headers: { 'x-forwarded-for': c.ip(1) } });
  const html = await g.text();
  const A = await agent(`${c.tag}-a`, c.ip(2));
  const one = await call(A, 'find', { program_id: id, project: { name: 'Clock33', description: 'Keeps time.' } });
  const guideOk = g.status === 200 && /Closed/.test(html) && !/Apply on the program site/.test(html);
  const findOk = /closed/i.test(one.sb) && !/Say yes and I apply/.test(one.sb);
  return { pass: guideOk && findOk, actual: `guide of an active program closed 2 h ago: HTTP ${g.status}${g.status === 200 ? (/Closed/.test(html) ? ' with Closed' : ' with no Closed line') : ''}; one-program find: "${one.sb.split('\n')[0]}"` };
});
