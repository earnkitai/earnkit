import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainName } from '../v5/chains';
import { codeRows, contract, daysAgo, evidence, liveRows, NOW, teamRows } from './fixtures/evidence-builder';
import { builderLine, currentBuilderLine, currentReviewerLine, reviewerLine, RULE_WORDS, ruleWords } from './tier-words';
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
  // M3 (v6.1.15 fix round 1): no deployer or mainnet in builder words.
  assert.equal(line, 'People outside the team use it live.');
});

test('no line says paying their own gas', () => {
  for (const [, e, x] of cases) {
    const p = place(e, x, undefined, NOW);
    for (const line of [reviewerLine(p, e), builderLine(p)]) assert.ok(!/own gas/.test(line), line);
  }
});

test('builder line for live matches the design example', () => {
  const p = place(evidence({ live: up, onchain: [contract({ tx_90d: 9, funded_senders_90d: 4 })] }), X, undefined, NOW);
  // #6 (v6.1.15): the builder reads the usage gap in plain words; the reviewer line keeps the exact rows.
  assert.equal(builderLine(p), 'Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4.');
  assert.equal(p.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 4.');
  assert.equal(reviewerLine(p, null), 'live: site loads, 9 transactions in 90 days on Base mainnet, 4 senders the deployer did not fund on Base mainnet, no flags.');
});

test('#15 (v6.1.15): the flag rule reads self-funded users, and a stored unfunded flag reads the same', () => {
  const e = evidence({ live: up, onchain: [contract({ tx_90d: 2_000, senders_90d: 1_500, funded_sample: 50, funded_senders_90d: 3 })] });
  const p = place(e, X, undefined, NOW);
  assert.deepEqual(p.flags.map((f) => f.rule), ['self_funded_users']);
  assert.match(reviewerLine(p, e), /^flagged \(self-funded users\): /);
  // L38-20 (v6.1.18): the reason, never "flagged" or "rule".
  assert.equal(builderLine(p).split(' Next: ')[0], 'Most of your users are wallets your team funded, so programs will not count them.');
  const legacy: Placement = { ...p, flags: p.flags.map((f) => ({ ...f, rule: 'unfunded' })) };
  assert.equal(reviewerLine(legacy, e), reviewerLine(p, e));
  assert.equal(builderLine(legacy), builderLine(p));
  // Both ids together are one rule, never "rules".
  const both: Placement = { ...p, flags: [...p.flags, ...legacy.flags] };
  assert.equal(builderLine(both).split(' Next: ')[0], 'Most of your users are wallets your team funded, so programs will not count them.');
  assert.deepEqual(RULE_WORDS, { self_funded_users: 'self-funded users', unfunded: 'self-funded users' });
  // Any other id reads with _ as a space.
  assert.match(reviewerLine({ ...p, flags: [{ rule: 'identical_pitch', detail: 'x' }] }, e), /^flagged \(identical pitch\): /);
});

test('builder head for live branches on gap, not on the next words', () => {
  const p = place(evidence({ live: up, onchain: [contract({ tx_90d: 9, funded_senders_90d: 4 })] }), X, undefined, NOW);
  const push = 'Push to the repo; EarnKit found no push date.';
  assert.equal(builderLine({ ...p, gap: 'push', next: push, builder_next: push }), 'Your project is live. Next: push to the repo; EarnKit found no push date.');
  assert.match(builderLine({ ...p, next: 'Anything at all.', builder_next: 'Anything at all.' }), /^Your project is live, with no verified usage yet\./);
});

test('numbers carry thousands separators in the builder line', () => {
  const p = place(evidence({ live: up, onchain: [contract({ tx_90d: 9, funded_senders_90d: 4 })] }), X, { ...DEFAULT_THRESHOLDS, used_funded_senders: 2_500 }, NOW);
  assert.match(builderLine(p), /about 2,500 outside users in 90 days; I count 4\./);
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
  assert.equal(builderLine(stale).split(' Next: ')[0], 'Your project has people using it live, with no recent code.');
  const noRepo = place(evidence({ onchain: users }), { identical_pitch: 0, shared_contributors: 0 }, undefined, NOW);
  assert.equal(noRepo.gap, 'site');
  assert.equal(builderLine(noRepo), 'Your project has people using it live, with no recent code. Next: a site that loads for your product.');
  // Commits, not users: the code line, whatever the because rows say.
  assert.equal(builderLine({ tier: 'building', flags: [], because: ['50 senders the deployer did not fund on Base mainnet'], next: null, builder_next: null, gap: 'site' }), 'Your project has code, with nothing live yet.');
});

test('I1/M2 (v6.1.15 fix round 1): lines stored before v6.1.15 read in today\'s words; today\'s lines are unchanged', () => {
  const BAD = /deployer|senders|mainnet|unfunded|onchain/;
  const legacy: [string, string][] = [
    ['Your project is in use: wallets the deployer did not fund use it on mainnet.', 'People outside the team use it live.'],
    ['Your project is live, with no verified usage yet. Next: 25 senders the deployer did not fund, on mainnet in 90 days; you have 4.',
      'Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4.'],
    ['Your project is live, with no verified usage yet. Next: 2,500 senders the deployer did not fund, on mainnet in 90 days; you have 1,204.',
      'Your project is live, with no verified usage yet. Next: about 2,500 outside users in 90 days; I count 1,204.'],
    ['Your project has code, with nothing live yet. Next: a live product: a site that loads or a mainnet contract in use.',
      'Your project has code, with nothing live yet. Next: a live product: a site that loads or a contract in use.'],
    ['Your project has onchain users, with no recent code. Next: a push to the repo in the last 60 days; the last was 200 days ago.',
      'Your project has people using it live, with no recent code. Next: a push to the repo in the last 60 days; the last was 200 days ago.'],
    ['Your project is flagged on the unfunded rule. Next: at least 20% of sampled wallets not funded by the deployer; 5 of 50 are.',
      'Most of your users are wallets your team funded, so programs will not count them. Next: at least 20% of sampled users from outside the team; I count 5 of 50.'],
    ['Your project is flagged on the identical pitch, unfunded rules. Next: a pitch in your own words; 3 other applicants sent the same text.',
      'Your project is flagged on the identical pitch rule. Most of your users are wallets your team funded, so programs will not count them. Next: a pitch in your own words; 3 other applicants sent the same text.'],
    // L38-21 (v6.1.18): the unverified read in the first person.
    ['Your project is unverified, with nothing recent EarnKit could check. Next: a public repo EarnKit can read.',
      'I found nothing recent to check yet. Next: a public repo EarnKit can read.'],
  ];
  for (const [old, now] of legacy) {
    assert.equal(currentBuilderLine(old), now);
    assert.doesNotMatch(currentBuilderLine(old), BAD, old);
  }
  // Today's lines pass through as they are.
  for (const [name, e, x] of cases) {
    const line = builderLine(place(e, x, undefined, NOW));
    assert.equal(currentBuilderLine(line), line, name);
  }
  assert.equal(currentReviewerLine('flagged (unfunded): 5 of 50 sampled senders on Base mainnet are wallets the deployer did not fund (150 senders in 90 days).'),
    'flagged (self-funded users): 5 of 50 sampled senders on Base mainnet are wallets the deployer did not fund (150 senders in 90 days).');
  assert.equal(currentReviewerLine('flagged (identical pitch, unfunded): x.'), 'flagged (identical pitch, self-funded users): x.');
  assert.equal(currentReviewerLine('used: 30 senders the deployer did not fund on Base mainnet, no flags.'), 'used: 30 senders the deployer did not fund on Base mainnet, no flags.');
  assert.equal(ruleWords('self_funded_users'), 'self-funded users');
});
