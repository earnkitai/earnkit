// L28-2 (Break): one team win counts twice in /api/stats, over the program's own cap ($7,000 on a $3,500 program).
// Expected (v6.1.16 Task 14): wins count once per repo per program; the co-founder's line reads `Your co-founder already recorded
// this win.` and adds nothing. Checked with readStats (the uncached read behind /api/stats): won +1, won_usd +3,500.
import { run, call, program, M } from './lib.mts';
import { readStats } from '../../lib/v5/stats.ts';
import { cofounders, send } from './team.mts';
await run('L28-2', 62, async (c) => {
  const g = c.pid('g3'); await program(g, 'Grant Three', M(3500));
  const { AA, BA, proj } = await cofounders(c, 'duo');
  const s0: any = await readStats(new Date());
  await send(AA, g, proj); await send(BA, g, proj);
  await call(AA, 'track', { program_id: g, status: 'won', amount_usd: 3500, project: proj });
  const y = await call(BA, 'track', { program_id: g, status: 'won', amount_usd: 3500, project: proj });
  const s1: any = await readStats(new Date());
  const dw = s1.won - s0.won, du = Number(s1.won_usd) - Number(s0.won_usd);
  return { pass: dw === 1 && du === 3500, actual: `co-founder's win said "${y.sb}"; stats won +${dw}, won_usd +${du} for one $3,500 team win` };
});
