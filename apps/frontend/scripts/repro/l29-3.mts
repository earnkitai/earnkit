// L29-3 (Break): "I won the X one, 5k": a win on a program not applied to here is refused and lost.
// Expected (v6.1.16 Task 15): `track won` with no application records a builder-submitted application and the win in one call:
// `Recorded: {title} won, $5,000. Noted as sent by you outside EarnKit.`
import { run, agent, builder, link, call, program, M, appsOf } from './lib.mts';
await run('L29-3', 83, async (c) => {
  const g = c.pid('pp'); await program(g, 'Hackathon', M(10000));
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  const w = await call(A, 'track', { program_id: g, status: 'won', amount_usd: 5000, project: { name: 'Lane Timer', description: 'Keeps time.' } });
  const [row] = await appsOf([`b:${B.id}`], g);
  return { pass: row?.status === 'won' && Number(row?.amount_usd) === 5000, actual: `track won $5,000 with no application said "${w.sb}" (note "${w.note.slice(0, 60)}"); row ${row ? `${row.status} ${row.amount_usd}` : 'none'}` };
});
