// L29-4 (Break): "stop applying": the agent's policy set is refused with a 20-item intake (`Still missing: ... and 17 more.`).
// Expected (v6.1.16 Task 15): refused with `Standing approval is yours to turn off at earnkit.com/me. Until then say stop for a
// program and I hold it.` and no missing-items list.
import { run, call } from './lib.mts';
import { standing } from './standing.mts';
await run('L29-4', 84, async (c) => {
  const { A } = await standing(c);
  const r = await call(A, 'record', { set: { policy: { auto_apply: false } } });
  const pass = /Standing approval is yours to turn off at earnkit\.com\/me/.test(r.sb) && !/missing/i.test(r.sb) && !/all together/.test(r.note);
  return { pass, actual: `record set policy off said "${r.sb}"` };
});
