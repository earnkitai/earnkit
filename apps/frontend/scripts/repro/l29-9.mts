// L29-9 (Break): every refusal is isError false, so an agent cannot tell "recorded" from "refused" without reading prose.
// Expected (v6.1.16 Task 15): every refusal (not read, not known, not yours, limit, outside approval, nothing recorded) returns
// isError true with the same text; HTTP stays 200. Four refusal paths are probed.
import { run, agent, builder, link, call, program, M } from './lib.mts';
await run('L29-9', 89, async (c) => {
  const g = c.pid('g1'); await program(g, 'Grant One', M(5000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  const cases: [string, string, any][] = [
    ['unknown program', 'track', { program_id: `zz-${c.nonce}-nothing`, status: 'applied', submitted_by: 'agent', fields_used: ['project_name'] }],
    ['bad status', 'track', { program_id: g, status: 'submitted' }],
    ['negative amount', 'track', { program_id: g, status: 'won', amount_usd: -5 }],
    ['policy set', 'record', { set: { policy: { auto_apply: true } } }],
  ];
  const out: string[] = []; let bad = 0;
  for (const [label, tool, args] of cases) {
    const r = await call(A, tool, args);
    if (!(r.isError && r.status === 200)) bad++;
    out.push(`${label}: HTTP ${r.status} isError ${r.isError} "${r.sb.slice(0, 45)}"`);
  }
  return { pass: bad === 0, actual: `${bad} of ${cases.length} refusals are not isError true: ${out.join('; ')}` };
});
