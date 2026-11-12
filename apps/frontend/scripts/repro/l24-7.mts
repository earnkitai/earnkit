// L24-7 (Break): screen keeps RLO, zero-width and CR/LF in refs and names, and echoes them to the reviewer.
// Expected (v6.1.16 Task 11): cleanText on every screen input at queue time; replies, results and stored rows carry no bidi,
// zero-width or control characters.
import { run, agent, builder, link, program, call, M, db } from './lib.mts';
import { addReviewer } from '../../lib/v6/reviewers.ts';
const BAD = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/;
await run('L24-7', 27, async (c) => {
  const scr = c.pid('scr'); await program(scr, 'Screen Grant', M(5000));
  const R = await builder(`${c.tag}-rev`); const RA = await agent(`${c.tag}-rev`, c.ip(1)); await link(RA, R); await addReviewer(scr, R.login, null);
  const q = await call(RA, 'screen', { program_id: scr, applicants: [
    { ref: 'a3‮gnp', name: 'Timer‮gnp.exe​', live_url: 'https://a3.up.test' },
    { ref: 'a4', name: 'Comma, "quote"\nnewline\r\nrow', live_url: 'https://a4.up.test' },
  ] });
  const o = await call(RA, 'screen', { job_id: q.j?.job_id, outcomes: [{ ref: 'zz‮', outcome: 'won', amount_usd: 100 }, { ref: '<b>x</b>', outcome: 'rejected' }] });
  const rows = await db`SELECT ref, name FROM screen_applicants WHERE job_id = ${q.j?.job_id}`;
  const dirty = rows.filter((r: any) => BAD.test(r.ref ?? '') || BAD.test(r.name ?? ''));
  const echo = BAD.test(o.sb) || BAD.test(q.sb);
  return { pass: rows.length > 0 && dirty.length === 0 && !echo, actual: `outcome reply "${o.sb}" ${echo ? 'carries a bidi/control character' : 'clean'}; stored ${dirty.length} of ${rows.length} applicants with bidi/control characters (${dirty.map((r: any) => JSON.stringify(r.ref) + ' ' + JSON.stringify(r.name)).join(', ')})` };
});
