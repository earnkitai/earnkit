// Shared setup for the standing-approval repros (L23-1, L24-4, L29-4, L29-5, L29-6): a linked builder with two
// easy l33 programs inside the limits and standing approval switched on through /me.
import { agent, builder, link, program, call, M, standingOn, type Ctx } from './lib.mts';
export async function standing(c: Ctx) {
  const y1 = c.pid('y1'), y2 = c.pid('y2');
  await program(y1, 'Alpha Grant', M(5000)); await program(y2, 'Beta Grant', M(4000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  await call(A, 'record', { set: { person: { name: 'On Lane', email: 'on@example.com' }, projects: [{ id: 'on', name: 'Lane Timer' }] } });
  const p = await standingOn(B);
  if (p.status !== 303) throw new Error(`standing approval form answered ${p.status}`);
  const proj = { name: 'Lane Timer', description: 'Keeps time for teams.' };
  const f = await call(A, 'find', { project: proj });
  return { B, A, proj, y1, y2, f };
}
