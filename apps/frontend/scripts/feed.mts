import './env.mts';
import { sql } from '../lib/earnkit/db';
import { rankFeed, setFeedFlag } from '../lib/earnkit/feed';

/**
 * v2.13 spec "Owner control": pnpm feed:pin <update-id> [--off], pnpm feed:hide <update-id> [--off].
 * Owner-run only. Pin: the update leads its week in the feed. Hide: it leaves the feed and stays on the profile.
 */
const [what, raw, flag] = process.argv.slice(2);
// pnpm feed:rank: rewrite the points of the last 12 weeks now (the daily cron step is only a catch-up).
if (what === 'rank') {
  console.log(JSON.stringify(await rankFeed(new Date(), { weeks: 12 })));
  await sql().end();
  process.exit(0);
}
const id = Number(raw);
if ((what !== 'pin' && what !== 'hide') || !Number.isInteger(id) || id <= 0 || (flag !== undefined && flag !== '--off')) {
  console.error('Usage: pnpm feed:rank | pnpm feed:pin <update-id> [--off] | pnpm feed:hide <update-id> [--off]');
  process.exit(2);
}
const done = await setFeedFlag(id, what, flag !== '--off');
console.log(done ? `${what}${flag ? ' off' : ''}: update ${id}` : `No update ${id}.`);
await sql().end();
process.exit(done ? 0 : 1);
