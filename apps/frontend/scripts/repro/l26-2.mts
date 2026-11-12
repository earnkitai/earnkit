// L26-2 (Break): record get and record brief reply with the whole record (about 370 KB for a full record).
// Expected (v6.1.16 Task 12): `record get` (no kind) returns the summary, under 20 KB; `record brief` under 8 KB;
// `record get {kind}` returns that kind in full.
import { run, agent, builder, link, call } from './lib.mts';
import { ANSWER_KINDS } from '../../lib/v5/program-file.ts';
const K = (n: number) => `${(n / 1024).toFixed(1)} KB`;
await run('L26-2', 42, async (c) => {
  const B = await builder(`${c.tag}-b`); const L = await agent(`${c.tag}-a`, c.ip(1)); await link(L, B);
  const text = (k: string, i: number) => (`${k} ${i}: ` + 'We build a timer that keeps teams on track and ships weekly. ').repeat(40).slice(0, 2000);
  const answers = (i: number) => Object.fromEntries((ANSWER_KINDS as readonly string[]).map((k) => [k, { text: text(k, i), short: text(k, i).slice(0, 270) }]));
  const projects = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `L33 Project ${i}`, live_url: `https://p${i}.up.test`, answers: answers(i + 1) }));
  const s = await call(L, 'record', { set: { answers: answers(0), projects, person: { name: 'L33 Builder', email: 'l33@example.com' } } });
  const g = await call(L, 'record', { get: true });
  const br = await call(L, 'record', { brief: 'problem' });
  const pass = g.bytes <= 20 * 1024 && br.bytes <= 8 * 1024 && !g.isError;
  return { pass, actual: `set "${s.sb.slice(0, 40)}"; record get ${K(g.bytes)} (cap 20 KB); record brief problem ${K(br.bytes)} (cap 8 KB)` };
});
