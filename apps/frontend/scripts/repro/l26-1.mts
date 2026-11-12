// L26-1 (Break): one looping agent locks its whole office out: refused retries still count on the address window.
// Expected (v6.1.16 Task 12): the installation's own limit is checked first and a call it refuses never counts on the address
// (or block) window; a colleague on the same address is served.
// Method: the hot agent's own hour is put at its cap (120) and the address hour at 597 of 600 directly in rate_windows
// (the same counters the server keeps); the hot agent then retries 5 times (all refused). Today each refusal still counts
// on the address, which passes 600 and refuses the colleague's first call.
import { run, agent, call, db } from './lib.mts';
await run('L26-1', 41, async (c) => {
  const ip = c.ip(1);
  const hot = await agent(`${c.tag}-hot`, ip); const mate = await agent(`${c.tag}-mate`, ip);
  const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  if (Date.now() - start.getTime() > 3_590_000) await new Promise((s) => setTimeout(s, 12_000)); // never straddle the hour
  const s2 = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const set = async (key: string, n: number) => db`INSERT INTO rate_windows (key, window_start, count) VALUES (${key}, ${s2}, ${n}) ON CONFLICT (key, window_start) DO UPDATE SET count = ${n}`;
  await set(`mcp:${hot.id}`, 120); await set(`mcpIp:${ip}`, 597);
  const refused: boolean[] = [];
  for (let i = 0; i < 5; i++) refused.push((await call(hot, 'find', {})).isError);
  if (!refused.every(Boolean)) return { pass: false, actual: `setup: the hot agent at its cap was served (${refused.join(',')}); limit keys changed? re-check the method` };
  const [w] = await db`SELECT count FROM rate_windows WHERE key = ${'mcpIp:' + ip} AND window_start = ${s2}`;
  const m = await call(mate, 'find', {});
  return { pass: !m.isError, actual: `after 5 refused retries the address window reads ${w?.count} of 600; the colleague's first call ${m.isError ? `refused: "${m.text}"` : 'served'}` };
});
