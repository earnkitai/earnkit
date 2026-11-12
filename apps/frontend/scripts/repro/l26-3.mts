// L26-3 (Break, owner call): 50 new connections an hour per address shuts out a hackathon or campus NAT from the 51st person.
// Expected (v6.1.16 Task 12): per-address floors of 200 an hour for register, token (installHour) and authorize; the
// 51st to 60th new agents from one address all connect.
import { run, tryAgent } from './lib.mts';
await run('L26-3', 43, async (c) => {
  const ip = c.ip(1);
  const res: { i: number; status: number; step?: string; body?: string }[] = [];
  for (let b = 0; b < 60; b += 10) {
    const batch = await Promise.all(Array.from({ length: 10 }, (_, k) => tryAgent(`${c.tag}-n${b + k + 1}`, ip).then((r) => ({ i: b + k + 1, status: r.status, step: r.step, body: r.body }))));
    res.push(...batch);
  }
  const failed = res.filter((r) => r.status !== 200).sort((a, b) => a.i - b.i);
  const first = failed[0];
  return { pass: failed.length === 0, actual: `${60 - failed.length} of 60 new agents from one address connected; first refused #${first?.i} at ${first?.step} ${first?.status} ${JSON.parse(first?.body ?? '{}').error_description ?? ''}` };
});
