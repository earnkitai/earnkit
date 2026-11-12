// L29-5 (Break): "Say stop to hold any." has no call behind it: no note line says what stop does (agents skip for good or ask 20 questions).
// Expected (v6.1.16 Task 15, with Task 11's `held`): the standing-approval note reads `On stop, call track with status held for each
// program named.`
import { run } from './lib.mts';
import { standing } from './standing.mts';
await run('L29-5', 85, async (c) => {
  const { f } = await standing(c);
  const stop = f.note.split('\n').find((l) => /On stop|says stop|say stop/i.test(l)) ?? '';
  return { pass: /On stop, call track with status held/.test(f.note), actual: `builder told "${f.sb.split('\n').find((l) => /Say stop/.test(l))?.replace(/ This agent is now linked.*/, '') ?? ''}"; note on stop: ${stop ? `"${stop.slice(0, 160)}"` : 'none'}` };
});
