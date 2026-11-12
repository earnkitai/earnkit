// L29-6 (Break): under standing approval the note says "for each ready program within the limits" but never names the list the
// server enforces (tonight.programs), so agents send others.
// Expected (v6.1.16 Task 15): the standing approval note lists the program ids it covers and says `only these`.
import { run } from './lib.mts';
import { standing } from './standing.mts';
await run('L29-6', 86, async (c) => {
  const { f, y1, y2 } = await standing(c);
  const l = f.note.split('\n').find((x) => /Standing approval is on/.test(x)) ?? '';
  const pass = /only these/.test(f.note) && f.note.includes(y1) && f.note.includes(y2);
  return { pass, actual: `standing note "${l.slice(0, 170)}"; names ${y1}: ${f.note.includes(y1)}, ${y2}: ${f.note.includes(y2)}; says only these: ${/only these/.test(f.note)}` };
});
