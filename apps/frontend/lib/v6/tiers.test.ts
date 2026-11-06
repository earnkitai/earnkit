import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeRows, contract, daysAgo, evidence, liveRows, NOW, teamRows } from './fixtures/evidence-builder';
import { DEFAULT_THRESHOLDS, place, TIERS } from './tiers';

const X = { identical_pitch: 0, shared_contributors: 0 };
const up = liveRows({ url: 'https://app.example.com', url_ok: true });
const down = liveRows({ url: 'https://app.example.com', url_ok: false, status: 503 });
const at = (e: Parameters<typeof place>[0], x = X, t = DEFAULT_THRESHOLDS) => place(e, x, t, NOW);
const used = () =>
  evidence({
    repo: 'a/b',
    live: up,
    onchain: [contract({ tx_90d: 400, senders_90d: 40, funded_senders_90d: 30, funded_sample: 40 })],
    code: codeRows({ last_push_at: daysAgo(10), commits_90d: 12 }),
    team: teamRows({ contributors_90d: 3 }),
  });

test('the five tiers in order', () => {
  assert.deepEqual([...TIERS], ['used', 'live', 'building', 'unverified', 'flagged']);
});

test('used: site up, 30 funded senders on a mainnet contract, pushed 10 days ago', () => {
  const p = at(used());
  assert.equal(p.tier, 'used');
  assert.deepEqual(p.flags, []);
  assert.equal(p.next, null);
  assert.ok(p.because.includes('30 funded senders on Base mainnet'), p.because.join(' | '));
  assert.ok(p.because.includes('pushed 10 days ago'));
  assert.ok(p.because.includes('3 contributors'));
  assert.ok(p.because.includes('no flags'));
});

test('live: the contract has 4 funded senders; next names the rule with the count', () => {
  const e = used();
  e.onchain = [contract({ tx_90d: 9, senders_90d: 4, funded_senders_90d: 4, funded_sample: 4 })];
  const p = at(e);
  assert.equal(p.tier, 'live');
  assert.equal(p.next, '25 funded wallets on mainnet in 90 days; you have 4.');
  assert.equal(p.gap, 'funded_senders');
  assert.ok(p.because.includes('site loads'), p.because.join(' | '));
});

test('next for live sums funded senders across mainnet contracts', () => {
  const e = used();
  e.onchain = [
    contract({ tx_90d: 9, funded_senders_90d: 4 }),
    contract({ address: `0x${'2'.repeat(40)}`, tx_90d: 3, funded_senders_90d: 1_200, mainnet: false }),
    contract({ address: `0x${'3'.repeat(40)}`, tx_90d: 3, funded_senders_90d: 6, chain: 'arbitrum' }),
    contract({ address: `0x${'4'.repeat(40)}`, tx_90d: 3, funded_senders_90d: null }),
  ];
  assert.equal(at(e).next, '25 funded wallets on mainnet in 90 days; you have 10.');
});

test('site only is live', () => {
  const p = at(evidence({ live: up }));
  assert.equal(p.tier, 'live');
  assert.ok(p.because.includes('site loads'));
  assert.equal(p.next, '25 funded wallets on mainnet in 90 days; you have 0.');
});

test('live by a contract alone: transactions in 90 days, repo pushed recently', () => {
  const p = at(
    evidence({ repo: 'a/b', onchain: [contract({ tx_90d: 1_240 })], code: codeRows({ last_push_at: daysAgo(5), commits_90d: 2 }) }),
  );
  assert.equal(p.tier, 'live');
  assert.ok(p.because.includes('1,240 transactions in 90 days on Base mainnet'), p.because.join(' | '));
});

test('a contract alone with a stale repo is not live', () => {
  const p = at(evidence({ repo: 'a/b', onchain: [contract({ tx_90d: 50 })], code: codeRows({ last_push_at: daysAgo(61), commits_90d: 0 }) }));
  assert.equal(p.tier, 'unverified');
  assert.equal(p.gap, 'commits');
  assert.ok(p.because.includes('50 transactions in 90 days on Base mainnet'), p.because.join(' | '));
  assert.ok(p.because.includes('pushed 61 days ago'));
  assert.ok(!p.because.includes('no transactions in 90 days on mainnet'));
});

test('used sums funded senders across mainnet contracts: two with 15 each', () => {
  const e = used();
  e.onchain = [
    contract({ tx_90d: 30, funded_senders_90d: 15 }),
    contract({ address: `0x${'2'.repeat(40)}`, tx_90d: 30, funded_senders_90d: 15 }),
  ];
  const p = at(e);
  assert.equal(p.tier, 'used');
  assert.equal(p.gap, null);
  assert.ok(p.because.includes('30 funded senders across 2 contracts on Base mainnet'), p.because.join(' | '));
});

test('live with no push date: its own next, never 0 days ago', () => {
  const e = used();
  e.code = codeRows({ last_push_at: null, commits_90d: 4 });
  const p = at(e);
  assert.equal(p.tier, 'live');
  assert.equal(p.gap, 'push');
  assert.equal(p.next, 'Push to the repo; EarnKit found no push date.');
});

test('an unparseable push date never renders NaN', () => {
  const e = used();
  e.code = codeRows({ last_push_at: 'not a date', commits_90d: 0 });
  const p = at(e);
  assert.equal(p.tier, 'live');
  assert.equal(p.next, 'Push to the repo; EarnKit found no push date.');
  assert.ok(!p.because.some((b) => b.includes('NaN')), p.because.join(' | '));
});

test('push window: pushed 61 days ago, site down, no contract activity, commits in the window is building', () => {
  const p = at(
    evidence({ repo: 'a/b', live: down, onchain: [contract({ tx_90d: 0 })], code: codeRows({ last_push_at: daysAgo(61), commits_90d: 3 }) }),
  );
  assert.equal(p.tier, 'building');
  assert.equal(p.gap, 'site');
});

test('building: no site, no contract, commits 20 days ago', () => {
  const p = at(evidence({ repo: 'a/b', live: down, code: codeRows({ last_push_at: daysAgo(20), commits_90d: 7 }) }));
  assert.equal(p.tier, 'building');
  assert.ok(p.because.includes('7 commits in 90 days'), p.because.join(' | '));
  assert.ok(p.because.includes('pushed 20 days ago'));
  assert.match(p.next!, /live product/);
});

test('building on a recent push when the commit count was not read', () => {
  const p = at(evidence({ repo: 'a/b', code: codeRows({ last_push_at: daysAgo(20), commits_90d: null }) }));
  assert.equal(p.tier, 'building');
});

test('unverified with nothing read', () => {
  const p = at(evidence());
  assert.equal(p.tier, 'unverified');
  assert.deepEqual(p.flags, []);
  assert.match(p.next!, /public repo or a live product/);
  assert.equal(p.gap, 'repo_or_site');
  assert.ok(p.because.includes('no flags'));
});

test('push window: pushed 61 days ago, site up, 30 funded senders is live, not used', () => {
  const e = used();
  e.code = codeRows({ last_push_at: daysAgo(61), commits_90d: 0 });
  const p = at(e);
  assert.equal(p.tier, 'live');
  assert.match(p.next!, /push/);
});

test('push window: pushed 61 days ago, site down, no contract activity, no commits in 90 days is unverified', () => {
  const p = at(
    evidence({ repo: 'a/b', live: down, onchain: [contract({ tx_90d: 0 })], code: codeRows({ last_push_at: daysAgo(61), commits_90d: 0 }) }),
  );
  assert.equal(p.tier, 'unverified');
});

test('is_contract false or mainnet null contracts never count', () => {
  const big = { tx_90d: 900, senders_90d: 90, funded_senders_90d: 80, funded_sample: 50 };
  for (const c of [contract({ ...big, is_contract: false }), contract({ ...big, mainnet: null }), contract({ ...big, mainnet: false })]) {
    const p = at(evidence({ onchain: [c] }));
    assert.equal(p.tier, 'unverified');
  }
  const site = at(evidence({ live: up, onchain: [contract({ ...big, is_contract: false })] }));
  assert.equal(site.tier, 'live');
  assert.equal(site.next, '25 funded wallets on mainnet in 90 days; you have 0.');
});

test('tx_90d of null or 0 is no activity', () => {
  assert.equal(at(evidence({ onchain: [contract({ tx_90d: null })] })).tier, 'unverified');
  assert.equal(at(evidence({ onchain: [contract({ tx_90d: 0 })] })).tier, 'unverified');
});

// The five flags, each at its boundary.
const flagged = (rule: string, e: Parameters<typeof place>[0], x = X) => {
  const p = at(e, x);
  assert.equal(p.tier, 'flagged', `${rule}: ${p.because.join(' | ')}`);
  assert.ok(p.flags.some((f) => f.rule === rule), JSON.stringify(p.flags));
  assert.ok(p.next && p.next.length > 0);
  assert.equal(p.gap, 'flag');
  return p;
};
const withCode = (o: Parameters<typeof codeRows>[0]) => {
  const e = used();
  e.code = codeRows({ last_push_at: daysAgo(10), commits_90d: 12, ...o });
  return e;
};

test('template: overlap 0.5 fires, 0.49 does not', () => {
  const p = flagged('template', withCode({ template_overlap: 0.5, own_share: 0.5, template_name: 'create-next-app' }));
  assert.ok(p.because.some((b) => b.includes('50%') && b.includes('create-next-app')), p.because.join(' | '));
  assert.equal(at(withCode({ template_overlap: 0.49, own_share: 0.51 })).tier, 'used');
});

test('fork: own share 0.1 fires', () => {
  flagged('fork', withCode({ fork_of: 'someone/else', own_share: 0.1 }));
});

test('fork with own work is not flagged', () => {
  assert.equal(at(withCode({ fork_of: 'someone/else', own_share: 0.5 })).tier, 'used');
});

test('fork at own share exactly 0.2 is not flagged', () => {
  assert.equal(at(withCode({ fork_of: 'someone/else', own_share: 0.2 })).tier, 'used');
});

test('identical pitch: 3 fires, 2 does not', () => {
  flagged('identical_pitch', used(), { identical_pitch: 3, shared_contributors: 0 });
  assert.equal(at(used(), { identical_pitch: 2, shared_contributors: 0 }).tier, 'used');
});

test('shared contributors at a count of 1 agrees in number', () => {
  const p = at(used(), { identical_pitch: 1, shared_contributors: 1 }, { ...DEFAULT_THRESHOLDS, flag_identical_pitch: 1, flag_shared_contributors: 1 });
  assert.ok(p.because.includes('1 other applicant shares contributors'), p.because.join(' | '));
  assert.ok(p.because.includes('1 other applicant sent the same pitch'));
  assert.ok(p.flags.some((f) => f.rule === 'shared_contributors'));
  const five = at(used(), { identical_pitch: 0, shared_contributors: 5 });
  assert.ok(five.because.includes('5 other applicants share contributors'), five.because.join(' | '));
  assert.equal(five.next, 'A team of your own; 5 other applicants share contributors with you.');
});

test('shared contributors: 5 fires, 4 does not', () => {
  flagged('shared_contributors', used(), { identical_pitch: 0, shared_contributors: 5 });
  assert.equal(at(used(), { identical_pitch: 0, shared_contributors: 4 }).tier, 'used');
});

test('unfunded: 150 senders, 5 of 50 sampled funded fires; 50 senders does not', () => {
  const e = used();
  e.onchain = [contract({ tx_90d: 900, senders_90d: 150, funded_sample: 50, funded_senders_90d: 5 })];
  const p = flagged('unfunded', e);
  assert.ok(p.because.some((b) => b.includes('5 of 50')), p.because.join(' | '));
  const few = used();
  few.onchain = [contract({ tx_90d: 900, senders_90d: 50, funded_sample: 50, funded_senders_90d: 5 })];
  assert.equal(at(few).tier, 'live');
  const edge = used();
  edge.onchain = [contract({ tx_90d: 900, senders_90d: 150, funded_sample: 50, funded_senders_90d: 10 })];
  assert.equal(at(edge).tier, 'live');
});

test('flagged comes first even when nothing else was read', () => {
  const p = flagged('identical_pitch', evidence(), { identical_pitch: 4, shared_contributors: 0 });
  assert.ok(!p.because.includes('no flags'));
});

test('thresholds override changes the outcome', () => {
  const e = used();
  assert.equal(at(e).tier, 'used');
  assert.equal(at(e, X, { ...DEFAULT_THRESHOLDS, used_funded_senders: 31 }).tier, 'live');
  assert.equal(at(e, X, { ...DEFAULT_THRESHOLDS, push_within_days: 5 }).tier, 'live');
  assert.equal(at(e, { identical_pitch: 2, shared_contributors: 0 }, { ...DEFAULT_THRESHOLDS, flag_identical_pitch: 2 }).tier, 'flagged');
});

test('tier is null when e is null and when a partial read read nothing', () => {
  for (const p of [at(null), at(evidence({ partial: true }))]) {
    assert.equal(p.tier, null);
    assert.deepEqual(p.flags, []);
    assert.equal(p.next, null);
    assert.equal(p.gap, null);
  }
});

test('a partial read with some blocks still places and says so', () => {
  const p = at(evidence({ partial: true, live: up }));
  assert.equal(p.tier, 'live');
  assert.ok(p.because.includes('read was partial'));
});

test('place defaults now and thresholds', () => {
  assert.equal(place(evidence({ live: up }), X).tier, 'live');
});
