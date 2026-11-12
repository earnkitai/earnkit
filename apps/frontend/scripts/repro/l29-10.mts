// L29-10 (Break): an input error's builder text is addressed to the agent (`I could not read that. Send the program, a status,
// and for a win the amount.`), so the builder is asked to "send a status".
// Expected (v6.1.16 Task 15): input errors carry no builder text; the agent note says what to fix and retry.
import { run, agent, call, program, M } from './lib.mts';
await run('L29-10', 90, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const A = await agent(`${c.tag}-a`, c.ip(1));
  const r = await call(A, 'track', { program_id: g, status: 'Submitted!' });
  const sb = String(r.j?.show_to_builder ?? '');
  return { pass: sb.trim() === '' && r.note.trim() !== '', actual: `bad status: builder text "${sb}"; note "${r.note.slice(0, 120)}"` };
});
