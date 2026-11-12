// L23-1 (Break): "Applying tonight" / "Tonight's sends go ahead" promise a run that does not exist.
// Expected (v6.1.16 Task 9; texts later refined by Task 11 L24-11 and Task 15 L29-22): no "tonight" and no
// "by tomorrow morning" in builder text; the standing-approval line still names the programs (`Applying now to ... under your standing approval.`).
import { run, line } from './lib.mts';
import { standing } from './standing.mts';
await run('L23-1', 11, async (c) => {
  const { f } = await standing(c);
  const bad = f.sb.split('\n').filter((l) => /tonight|tomorrow morning/i.test(l));
  const named = line(f.sb, /L33 Alpha Grant.*L33 Beta Grant|L33 Beta Grant.*L33 Alpha Grant/);
  const stand = f.sb.split('\n').find((l) => /standing approval|Applying|I apply/.test(l) && /L33 Alpha Grant/.test(l)) ?? '';
  return { pass: bad.length === 0 && stand !== '', actual: `standing-approval find says "${bad.join(' / ') || '(no tonight line)'}"; programs line "${stand || named || 'missing'}"` };
});
