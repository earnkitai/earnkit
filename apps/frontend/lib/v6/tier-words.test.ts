import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainName } from '../v5/chains';
import { codeRows, contract, daysAgo, evidence, liveRows, NOW, teamRows } from './fixtures/evidence-builder';
import { builderLine, reviewerLine } from './tier-words';
import { DEFAULT_THRESHOLDS, place, type Placement } from './tiers';

const X = { identical_pitch: 0, shared_contributors: 0 };
const up = liveRows({ url: 'https://app.example.com', url_ok: true });
const BANNED = /score|rank|grade|points|coin|token|streak/i;
const usedE = () =>
  evidence({
    repo: 'a/b', live: up, team: teamRows({ contributors_90d: 3 }),
    onchain: [contract({ tx_90d: 9_000, senders_90d: 1_500, funded_senders_90d: 1_240, funded_sample: 1_300 })],
    code: codeRows({ last_push_at: daysAgo(12), commits_90d: 40 }),
  });
const cases: [string, Parameters<typeof place>[0], typeof X][] = [
  ['used', usedE(), X],
  ['live', evidence({ live: up, onchain: [contract({ tx_90d: 9, funded_senders_90d: 4 })] }), X],
  ['building', evidence({ repo: 'a/b', code: codeRows({ last_push_at: daysAgo(3), commits_90d: 2 }) }), X],
  ['unverified', evidence(), X],
  ['flagged', usedE(), { identical_pitch: 3, shared_contributors: 6 }],
  ['flagged template', evidence({ repo: 'a/b', code: codeRows({ template_overlap: 0.7, own_share: 0.3, template_name: 'create-next-app', files_own: 4 }) }), X],
  ['flagged unfunded', evidence({ live: up, onchain: [contract({ tx_90d: 2_000, senders_90d: 1_500, funded_sample: 50, funded_senders_90d: 3 })] }), X],
  ['null', null, X],
  ['partial nothing', evidence({ partial: true }), X],
  ['partial', evidence({ partial: true, live: up }), X],
];

test('every line: no em dash, no banned word, ends with a full stop', () => {
  for (const [name, e, x] of cases) {
    const p = place(e, x, undefined, NOW);
    for (const line of [reviewerLine(p, e), builderLine(p)]) {
      assert.ok(!line.includes('—') && !line.includes('–'), `${name}: ${line}`);
      assert.ok(!BANNED.test(line), `${name}: ${line}`);
      assert.ok(line.endsWith('.') && !line.endsWith('..'), `${name}: ${line}`);
    }
  }
});

test('reviewer line for used reads like the design example, with thousands separators and the chain name', () => {
  const e = usedE();
  const line = reviewerLine(place(e, X, undefined, NOW), e);
  assert.equal(line, `used: 1,240 senders the deployer did not fund on ${chainName('base')} mainnet, site loads, pushed 12 days ago, 3 contributors, no flags.`);
  assert.ok(line.includes('Base mainnet'));
});

test('reviewer line for a flagged placement names the rule', () => {
  const e = usedE();
  const line = reviewerLine(place(e, { identical_pitch: 3, shared_contributors: 0 }, undefined, NOW), e);
  assert.match(line, /^flagged \(identical pitch\): /);
  const t = evidence({ repo: 'a/b', code: codeRows({ template_overlap: 0.7, template_name: 'create-next-app', files_own: 4 }) });
  assert.match(reviewerLine(place(t, X, undefined, NOW), t), /template/);
});

test('builder line for used has no Next', () => {
  const line = builderLine(place(usedE(), X, undefined, NOW));
  assert.ok(!line.includes('Next'), line);
  assert.equal(line, 'Your project is in use: wallets the deployer did not fund use it on mainnet.');
});

test('no line says paying their own gas', () => {
  for (const [, e, x] of cases) {
    const p = place(e, x, undefined, NOW);
    for (const line of [reviewerLine(p, e), builderLine(p)]) assert.ok(!/own gas/.test(line), line);
  }
});

test('builder line for live matches the design example', () => {
  const p = place(evidence({ live: up, onchain: [contract({ tx_90d: 9, funded_senders_90d: 4 })] }), X, undefined, NOW);
  assert.equal(builderLine(p), 'Your project is live, with no verified usage yet. Next: 25 senders the deployer did not fund, on mainnet in 90 days; you have 4.');
});

test('builder head for live branches on gap, not on the next words', () => {
  const p = place(evidence({ live: up, onchain: [contract({ tx_90d: 9, funded_senders_90d: 4 })] }), X, undefined, NOW);
  assert.equal(builderLine({ ...p, gap: 'push', next: 'Push to the repo; EarnKit found no push date.' }), 'Your project is live. Next: push to the repo; EarnKit found no push date.');
  assert.match(builderLine({ ...p, next: 'Anything at all.' }), /^Your project is live, with no verified usage yet\./);
});

test('numbers carry thousands separators in the builder line', () => {
  const p = place(evidence({ live: up, onchain: [contract({ tx_90d: 9, funded_senders_90d: 4 })] }), X, { ...DEFAULT_THRESHOLDS, used_funded_senders: 2_500 }, NOW);
  assert.match(builderLine(p), /2,500 senders the deployer did not fund/);
});

test('no tier yet reads plainly', () => {
  const p: Placement = place(null, X, undefined, NOW);
  assert.match(reviewerLine(p, null), /not read yet/);
  assert.match(builderLine(p), /not read yet/);
  const partial = evidence({ partial: true });
  assert.match(reviewerLine(place(partial, X, undefined, NOW), partial), /retry/);
});


test('M1 (v6.1.14 fix round 1): building on onchain users with no recent commit reads so, from the placement, not the row text', async () => {
  const { place } = await import('./tiers');
  const { codeRows, contract, daysAgo, evidence, NOW } = await import('./fixtures/evidence-builder');
  const users = [contract({ tx_90d: 0, senders_90d: 60, funded_senders_90d: 50, funded_sample: 50 })];
  const stale = place(evidence({ repo: 'a/b', onchain: users, code: codeRows({ last_push_at: daysAgo(200), commits_90d: 0 }) }), { identical_pitch: 0, shared_contributors: 0 }, undefined, NOW);
  assert.equal(stale.gap, 'push');
  assert.equal(builderLine(stale).split(' Next: ')[0], 'Your project has onchain users, with no recent code.');
  const noRepo = place(evidence({ onchain: users }), { identical_pitch: 0, shared_contributors: 0 }, undefined, NOW);
  assert.equal(noRepo.gap, 'site');
  assert.equal(builderLine(noRepo), 'Your project has onchain users, with no recent code. Next: a site that loads for your product.');
  // Commits, not users: the code line, whatever the because rows say.
  assert.equal(builderLine({ tier: 'building', flags: [], because: ['50 senders the deployer did not fund on Base mainnet'], next: null, gap: 'site' }), 'Your project has code, with nothing live yet.');
});
