import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolLine, poolStated, poolTotalText, usdCompact } from './pool';
import { ProgramFile } from './program-file';
import { committedProgram } from './fixtures/program-file';

test('v2.7.1: usdCompact is one decimal at most and never rounds up', () => {
  assert.equal(usdCompact(1_300_000), '$1.3M');
  assert.equal(usdCompact(1_299_999), '$1.2M');
  assert.equal(usdCompact(840_000), '$840K');
  assert.equal(usdCompact(250_000), '$250K');
  assert.equal(usdCompact(10_000), '$10K');
  assert.equal(usdCompact(10_500), '$10.5K');
  assert.equal(usdCompact(500), '$500');
});

test('v2.7.1: poolStated finds the pool in the curated reward text, with its "+" and currency', () => {
  assert.deepEqual(poolStated(840000, '$840,000 in prizes: $30,000 grand prize'), { plus: false, usdc: false });
  assert.deepEqual(poolStated(250000, '$250,000+ prize pool: $30,000 per track'), { plus: true, usdc: false });
  assert.deepEqual(poolStated(10000, '500 USDC per microgrant (20 microgrants, 10,000 USDC pool)'), { plus: false, usdc: true });
  assert.deepEqual(poolStated(200000, 'amount per grant not stated; Cohort 2 shows $200K available'), { plus: false, usdc: false });
  assert.equal(poolStated(250000, '$2,500,000 in prizes'), null);
  assert.equal(poolStated(30000, '$300,000 in prizes'), null);
  assert.equal(poolStated(5000, 'Up to $50,000 in grants'), null);
});

test('v2.7.1: poolLine and the hero total', () => {
  assert.equal(poolLine(840000, { plus: false, usdc: false }, "Crypto World's Fair Hackathon"), '$840K in prizes');
  assert.equal(poolLine(250000, { plus: true, usdc: false }, 'Monad Metropolis Hackathon'), '$250K+ in prizes');
  assert.equal(poolLine(10000, { plus: false, usdc: true }, 'Arc Microgrants'), '10,000 USDC pool');
  assert.equal(poolLine(200000, { plus: false, usdc: false }, 'Circle Developer Grants'), '$200K in grants');
  assert.equal(poolTotalText([{ pool_usd: 840000, plus: false }, { pool_usd: 10000, plus: false }]), '$850K');
  assert.equal(poolTotalText([{ pool_usd: 840000, plus: false }, { pool_usd: null, plus: false }]), '$840K+');
  assert.equal(poolTotalText([{ pool_usd: 10000, plus: true }]), '$10K+');
  assert.equal(poolTotalText([{ pool_usd: null, plus: false }]), null);
  assert.equal(poolTotalText([]), null);
});

test('v2.7.1: programs:check refuses a pool the reward text does not state, and a pool on a campaign', () => {
  const arc = committedProgram('arc-microgrants');
  assert.equal(ProgramFile.safeParse(arc).success, true);
  const wrong = ProgramFile.safeParse({ ...arc, pool_usd: 20000 });
  assert.equal(wrong.success, false);
  assert.match(JSON.stringify(wrong.error?.issues), /pool_usd 20000 must be stated in reward/);
  const camp = ProgramFile.safeParse({ ...committedProgram('earnkit-campaign-1-base'), pool_usd: 100 });
  assert.match(JSON.stringify(camp.error?.issues), /pool_usd is for curated programs/);
  // The four sourced pools; Base publishes none.
  const pools = Object.fromEntries(
    ['colosseum-worlds-fair', 'monad-metropolis', 'arc-microgrants', 'circle-developer-grants', 'base-builder-grants'].map((id) => [
      id,
      ProgramFile.parse(committedProgram(id)).pool_usd ?? null,
    ]),
  );
  assert.deepEqual(pools, {
    'colosseum-worlds-fair': 840000,
    'monad-metropolis': 250000,
    'arc-microgrants': 10000,
    'circle-developer-grants': 200000,
    'base-builder-grants': null,
  });
});
