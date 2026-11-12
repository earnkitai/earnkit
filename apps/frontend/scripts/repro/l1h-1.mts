// L1h-1 (Break): K or M money remains in guide prose, rewards, past rounds and EarnKit's own field hints
// (`$100K in prizes`, `A $1M audit subsidy`, `Your path to $10M annual revenue.`), on 11 guides and in the lookup JSON.
// Expected (v6.1.16 Task 8): full figures in description, reward, past rounds and hint text of every program file, so every guide
// page and every one-program find carries none; a program's verbatim form label is exempt (labels are stripped before the check).
import { run, agent, call, db, O } from './lib.mts';
const KM = /\$\s?\d[\d,.]*\s?[KkMm]\b|\b\d[\d,.]*[KkMm] (?:ARB|USDC|USDG|USD)\b/g;
const text = (h: string) => (/<main[\s\S]*?<\/main>/.exec(h)?.[0] ?? h).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
await run('L1h-1', 99, async (c) => {
  const ids = (await db`SELECT id FROM programs WHERE id !~ '^l[0-9]+-' ORDER BY id`).map((r: any) => r.id as string);
  const A = await agent(`${c.tag}-a`, c.ip(1));
  const hits: string[] = []; let pagesHit = 0, jsonHit = 0;
  for (const id of ids) {
    const r = await call(A, 'find', { program_id: id });
    const labels: string[] = [...(r.j?.fields ?? []), ...(r.j?.program?.submission_requirements ?? [])].map((f: any) => String(f?.label ?? '')).filter(Boolean);
    const p = r.j?.program ?? {};
    const agentText = JSON.stringify({ d: p.description, rw: p.reward, pr: p.past_rounds, h: (r.j?.fields ?? []).map((f: any) => [f.hint, f.todo]), n: r.j?.needs, nu: r.j?.need_you });
    const j = agentText.match(KM) ?? [];
    if (j.length) { jsonHit++; hits.push(`${id} json ${[...new Set(j)].slice(0, 2).join(' ')}`); }
    let g = text(await (await fetch(`${O}/programs/${id}`, { headers: { 'x-forwarded-for': c.ip(2) } })).text());
    for (const l of labels) g = g.split(l).join(' ');
    const m = g.match(KM) ?? [];
    if (m.length) { pagesHit++; hits.push(`${id} page ${[...new Set(m)].slice(0, 2).join(' ')}`); }
  }
  return { pass: hits.length === 0, actual: `K/M money on ${pagesHit} of ${ids.length} guide pages and in ${jsonHit} lookup replies: ${hits.slice(0, 8).join('; ')}` };
});
