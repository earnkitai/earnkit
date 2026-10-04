import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ceilSig, earnkitTexts, goLive, goLiveBlocker } from './campaign-text';
import { MIN_EOA_NONCE } from './campaigns';
import { ProgramFile } from './program-file';
import type { EarnKitCampaign } from './campaigns';

const campaign: EarnKitCampaign = {
  kind: 'earnkit',
  prize: { token: '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07', symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5,
  amount_each: '84800000',
  prize_usd_total: 500,
  priced_at: '2026-10-04',
  metric: 'unique_wallets',
  min_score: 10,
};
const window = { starts_at: '2026-10-04T12:00:00Z', ends_at: '2026-10-18T12:00:00Z' };
const FILE = join(import.meta.dirname, '../../../../programs/earnkit-campaign-1-base.json');

test('earnkitTexts: the reward, summary and rules come from the fields, money first', () => {
  const t = earnkitTexts({ ...window, campaign });
  assert.equal(t.reward, '$500 in MINI: $100 each to the top 5 (84,800,000 MINI each)');
  assert.equal(t.summary, '$100 each to top 5 (in MINI) · closes Oct 18');
  assert.deepEqual(t.rules, [
    'Agents only: the project is built and entered by an AI agent through EarnKit.',
    'Build on Base mainnet. Every contract you enter must be deployed on or after Oct 4, 2026, 12:00 UTC, from your payout wallet or from a wallet that signs your entry.',
    "Score: unique users of your contracts from Oct 4, 2026, 12:00 UTC to Oct 18, 2026, 12:00 UTC. Counted: wallets that sent successful transactions to them directly and had 3+ transactions before the start, and smart-wallet users whose user operation called them and whose wallet had 3+ user operations before the start. Calls through other contracts (routers, Multicall) and your payout and deployer wallets don't count.",
    'At least 10 users to be eligible. The top 5 eligible entries win; ties go to the earlier entry. One prize per payout wallet and per agent: the next entry takes the slot.',
    'After the end, the top entries and their evidence are public for 48 hours. EarnKit removes entries with farmed or wash activity, and the next entry moves up.',
    'Prize: 84,800,000 MINI per winner ($100 at the MINI price on 2026-10-04), paid automatically on Base to the payout wallet you enter, by Oct 20.',
    'One entry per repo and per contract. Up to 5 contracts per entry.',
  ]);
  assert.ok(!JSON.stringify(t).match(/token/i), 'no token text in a campaign\'s rules');
});

test('ceilSig rounds up to 3 significant digits', () => {
  assert.equal(ceilSig(84_745_762.7), 84_800_000);
  assert.equal(ceilSig(85_000_000), 85_000_000);
  assert.equal(ceilSig(0.123456), 0.124);
  assert.throws(() => ceilSig(0));
});

test('goLive: 14 days from now, MINI priced now, active, texts regenerated, no token_policy added', () => {
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  const next = goLive(raw, { now: new Date('2026-10-05T09:30:41Z'), price: 0.00000118 });
  assert.equal(next.status, 'active');
  assert.equal(next.starts_at, '2026-10-05T09:30:00Z');
  assert.equal(next.ends_at, '2026-10-19T09:30:00Z');
  assert.equal(next.verified_at, '2026-10-05');
  const c = next.campaign as EarnKitCampaign;
  assert.equal(c.amount_each, '84800000');
  assert.equal(c.priced_at, '2026-10-05');
  assert.equal(next.summary, '$100 each to top 5 (in MINI) · closes Oct 19');
  assert.ok(!('token_policy' in next));
  assert.equal(ProgramFile.safeParse(next).success, true);
});

test('Campaign #1 file: valid, and its texts are the generated ones (pnpm programs:check enforces it)', () => {
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.equal(ProgramFile.safeParse(raw).success, true);
  assert.equal(raw.status, 'closed', 'stays closed until the owner runs golive');
  assert.equal(raw.max_award_usd, 100);
  assert.equal(raw.campaign.prize_usd_total, 500);
  assert.ok(!('token_policy' in raw));
  // A hand edit of the dates without regenerating the rules is refused.
  const edited = ProgramFile.safeParse({ ...raw, ends_at: '2026-11-30T00:00:00Z' });
  assert.equal(edited.success, false);
  assert.match(JSON.stringify(edited.error?.issues), /generated/);
});

test('I3: the rules state the bar scoreEntry applies (3+ prior transactions or user operations; no router hops)', () => {
  const score = earnkitTexts({ ...window, campaign }).rules.find((r) => r.startsWith('Score:'))!;
  assert.equal(MIN_EOA_NONCE, 3, 'the rules say 3+: change both together');
  assert.match(score, /sent successful transactions to them directly and had 3\+ transactions before the start/);
  assert.match(score, /smart-wallet users whose user operation called them and whose wallet had 3\+ user operations before the start/);
  assert.match(score, /through other contracts \(routers, Multicall\)[^.]*don't count/);
  assert.doesNotMatch(score, /already existed|contracts that call them/);
});

test('I4: golive refuses an active or launched-and-started campaign; a never-launched file is fine', () => {
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  const now = new Date('2026-10-05T09:30:41Z');
  // Campaign #1 as committed: closed, placeholder dates in the past, never priced.
  assert.equal(goLiveBlocker(raw, now), null);
  const live = goLive(raw, { now, price: 0.00000118 });
  assert.match(goLiveBlocker(live, now)!, /^earnkit-campaign-1-base started 2026-10-05T09:30:00Z\. Going live again moves its start and end to now and re-prices the prize: the scoring window shifts and a payout in review pauses\. Pass --force to do it anyway\.$/);
  assert.match(goLiveBlocker(live, new Date('2026-10-25T00:00:00Z'))!, /ended 2026-10-19T09:30:00Z/);
  // Closed after it ran (launched, started): still refused.
  assert.match(goLiveBlocker({ ...live, status: 'closed' }, new Date('2026-10-25T00:00:00Z'))!, /ended/);
  assert.match(goLiveBlocker({ ...raw, status: 'active', starts_at: '2026-11-01T00:00:00Z' }, now)!, /is active/);
});
