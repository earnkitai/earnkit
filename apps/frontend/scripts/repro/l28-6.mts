// L28-6 (Break): after a repo rename (or transfer) the program's result never arrives and confirmed rules are lost.
// Expected (v6.1.16 Task 14): projects keep the GitHub repo id with the URL, so a renamed repo keeps its key: a screen result
// listed under the new name with the builder's application id lands on her ledger.
// Rename simulated with seeded repo reads: the old name's read answers with the new html_url and full_name (what GitHub's
// redirect gives) and both carry the same repo id. If the fix needs a live GitHub read for the id, this stays FAIL locally.
import { run, agent, builder, link, call, program, M, appsOf, seedRepo } from './lib.mts';
import { addReviewer } from '../../lib/v6/reviewers.ts';
import { send } from './team.mts';
await run('L28-6', 66, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const oldK = c.repo('oldname'), newK = c.repo('newname');
  const C = await builder(`${c.tag}-carol`);
  const facts = { readme_lead: 'Clock tells time.', id: 733066, repo_id: 733066, full_name: newK, html_url: `https://github.com/${newK}`, contributors: [C.login] };
  await seedRepo(newK, facts); const CA = await agent(`${c.tag}-carol`, c.ip(1)); await link(CA, C);
  const R = await builder(`${c.tag}-rev`); const RA = await agent(`${c.tag}-rev`, c.ip(2)); await link(RA, R); await addReviewer(g, R.login, null);
  await seedRepo(oldK, { ...facts, html_url: `https://github.com/${oldK}`, full_name: oldK }); // read before the rename
  const ap = await send(CA, g, { name: 'Clock', description: 'Tells time', repo_url: `https://github.com/${oldK}` });
  await seedRepo(oldK, facts); // after the rename the old name redirects to the new one
  const q = await call(RA, 'screen', { program_id: g, applicants: [{ ref: 'clock', name: 'Clock', repo_url: `https://github.com/${newK}`, application_id: ap.j?.application_id }] });
  const o = await call(RA, 'screen', { job_id: q.j?.job_id, outcomes: [{ ref: 'clock', outcome: 'won', amount_usd: 1500 }] });
  const [row] = await appsOf([`b:${C.id}`], g);
  return { pass: row?.status === 'won', actual: `result for the renamed repo: "${o.sb}" (note "${o.note.replace(/^Tell the builder the outcomes are recorded\. /, '').slice(0, 110)}"); carol's row ${row?.status} on ${row?.project_id}` };
});
