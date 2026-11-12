// L24-4 (Break): "Say stop to hold any." has no action: track has no hold, skipped is permanent.
// Expected (v6.1.16 Task 11): track status `held` keeps the claim and stops the send: `Held {title}. Say go when you want it sent.`;
// the standing approval closing reads `Say stop and I hold any of them.`
import { run, call, appsOf } from './lib.mts';
import { standing } from './standing.mts';
await run('L24-4', 24, async (c) => {
  const { A, B, proj, y2, f } = await standing(c);
  const h = await call(A, 'track', { program_id: y2, status: 'held', project: proj });
  const [row] = await appsOf([`b:${B.id}`], y2);
  const closing = f.sb.split('\n').find((l) => /Say stop/.test(l)) ?? '';
  const pass = /^Held L33 Beta Grant\./.test(h.sb) && !/Nothing was recorded/.test(h.note);
  return { pass, actual: `closing "${closing.replace(/ This agent is now linked.*/, '')}"; track held said "${h.sb}" (note "${h.note.slice(0, 90)}"); row ${row?.status ?? 'none'}` };
});
