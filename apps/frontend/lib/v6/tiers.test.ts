import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepo } from '../v5/github';
import { replayFetch } from '../v5/fixtures/github';
import BOILERPLATES from './boilerplates.json';
import { type Boilerplate, readCode } from './code';
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
  assert.ok(p.because.includes('30 senders the deployer did not fund on Base mainnet'), p.because.join(' | '));
  assert.ok(p.because.includes('pushed 10 days ago'));
  assert.ok(p.because.includes('3 contributors'));
  assert.ok(p.because.includes('no flags'));
});

test('live: the contract has 4 funded senders; next names the rule with the count', () => {
  const e = used();
  e.onchain = [contract({ tx_90d: 9, senders_90d: 4, funded_senders_90d: 4, funded_sample: 4 })];
  const p = at(e);
  assert.equal(p.tier, 'live');
  assert.equal(p.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 4.');
  assert.equal(p.gap, 'funded_senders');
  assert.ok(p.because.includes('site loads'), p.because.join(' | '));
});

test('next for live reports the top counted contract, never a sum', () => {
  const e = used();
  e.onchain = [
    contract({ tx_90d: 9, funded_senders_90d: 4 }),
    contract({ address: `0x${'2'.repeat(40)}`, tx_90d: 3, funded_senders_90d: 1_200, mainnet: false }),
    contract({ address: `0x${'3'.repeat(40)}`, tx_90d: 3, funded_senders_90d: 6, chain: 'arbitrum' }),
    contract({ address: `0x${'4'.repeat(40)}`, tx_90d: 3, funded_senders_90d: null }),
  ];
  const p = at(e);
  assert.equal(p.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 6.');
  assert.ok(p.because.includes('6 senders the deployer did not fund on Arbitrum mainnet'), p.because.join(' | '));
  assert.ok(p.because.includes('3 counted contracts'));
});

test('site only is live', () => {
  const p = at(evidence({ live: up }));
  assert.equal(p.tier, 'live');
  assert.ok(p.because.includes('site loads'));
  assert.equal(p.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 0.');
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

test('usage is one contract: two with 15 each are live, not used', () => {
  const e = used();
  e.onchain = [
    contract({ tx_90d: 30, funded_senders_90d: 15 }),
    contract({ address: `0x${'2'.repeat(40)}`, tx_90d: 30, funded_senders_90d: 15 }),
  ];
  const p = at(e);
  assert.equal(p.tier, 'live');
  assert.equal(p.gap, 'funded_senders');
  assert.equal(p.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 15.');
  assert.ok(p.because.includes('15 senders the deployer did not fund on Base mainnet'), p.because.join(' | '));
  assert.ok(p.because.includes('2 counted contracts'));
  assert.ok(!p.because.some((b) => b.includes('across')));
  e.onchain[1] = { ...e.onchain[1], funded_senders_90d: 25 };
  const q = at(e);
  assert.equal(q.tier, 'used');
  assert.ok(q.because.includes('25 senders the deployer did not fund on Base mainnet'), q.because.join(' | '));
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

test('building is commits in 60 days: 3 in 90 days but none in 60 is unverified; 1 in 60 is building', () => {
  const e = (commits_60d: number) =>
    evidence({ repo: 'a/b', live: down, onchain: [contract({ tx_90d: 0 })], code: codeRows({ last_push_at: daysAgo(61), commits_90d: 3, commits_60d }) });
  const none = at(e(0));
  assert.equal(none.tier, 'unverified');
  assert.ok(none.because.includes('no commits in 60 days'), none.because.join(' | '));
  const one = at(e(1));
  assert.equal(one.tier, 'building');
  assert.equal(one.gap, 'site');
  assert.ok(one.because.includes('1 commit in 60 days'), one.because.join(' | '));
});

test('building: no site, no contract, commits 20 days ago', () => {
  const p = at(evidence({ repo: 'a/b', live: down, code: codeRows({ last_push_at: daysAgo(20), commits_90d: 7 }) }));
  assert.equal(p.tier, 'building');
  assert.ok(p.because.includes('7 commits in 60 days'), p.because.join(' | '));
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
  assert.equal(site.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 0.');
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

test('template: under 10 files beyond the starter fires; 10 does not; overlap alone never does', () => {
  const p = flagged('template', withCode({ template_overlap: 0.9, own_share: 0.1, template_name: 'create-next-app', files_own: 9 }));
  assert.ok(p.because.some((b) => b.includes('90%') && b.includes('create-next-app') && b.includes('9 files beyond it')), p.because.join(' | '));
  assert.equal(p.next, 'At least 10 files of your own beyond the starter; yours has 9.');
  assert.equal(at(withCode({ template_overlap: 0.9, own_share: 0.1, template_name: 'create-next-app', files_own: 10 })).tier, 'used');
  assert.equal(at(withCode({ template_overlap: 0.95, own_share: 0.05, template_name: 'create-next-app', files_own: null })).tier, 'used');
});

test('fork of a non-starter: own share 0.1 still fires', () => {
  flagged('fork', withCode({ fork_of: 'someone/else', own_share: 0.1, commits_own: 400 }));
});

test('fork of a known starter: under 20 own commits fires, 25 does not, whatever the share', () => {
  const p = flagged('fork', withCode({ fork_of: 'scaffold-eth/scaffold-eth-2', own_share: 0.9, commits_own: 5 }));
  assert.ok(p.because.includes('fork of the scaffold-eth/scaffold-eth-2 starter with 5 commits after the fork'), p.because.join(' | '));
  assert.equal(p.next, 'At least 20 commits of your own after the fork; yours has 5.');
  assert.equal(at(withCode({ fork_of: 'scaffold-eth/scaffold-eth-2', own_share: 0.01, commits_own: 25 })).tier, 'used');
  assert.equal(at(withCode({ fork_of: 'Scaffold-ETH/Scaffold-ETH-2', own_share: 0.01, commits_own: 19 })).tier, 'flagged');
});

const replay = (slug: string) => replayFetch(`../../../v6/fixtures/repos/${slug}`);
const starterCode = async (tree: string[], fork?: { full_name: string; default_branch: string }) => {
  const f = (async (input: RequestInfo | URL) =>
    String(input).includes('/search/issues') ? Response.json({ total_count: 0, items: [] }) : Response.json([])) as typeof fetch;
  const read = {
    repo: { full_name: 'a/b', html_url: '', homepage: null, default_branch: 'main', created_at: '2025-01-01T00:00:00Z', pushed_at: daysAgo(3), ...(fork && { fork: true, parent: fork }) },
    tree: tree.map((path) => ({ path, type: 'blob' })), readme: null, files: [], first_commit_at: '2025-01-01T00:00:00Z', partial: false,
  };
  return readCode(read, { gh: f, now: NOW, budget: { remaining: null, stopped: false } });
};

test('starters, read for real: astral-logbook (213 own commits) is not flagged; a scaffold-eth-2 clone with 40 own files is not, with 3 is', async () => {
  const rec = replay('astral-logbook');
  const read = await readRepo(rec.repo, { fetch: rec.fetch, token: 'test' });
  const astral = await readCode(read, { gh: rec.fetch, now: NOW, budget: { remaining: null, stopped: false } });
  assert.equal(astral.commits_own, 213);
  const e = used();
  e.code = astral;
  assert.ok(at(e).flags.length === 0, JSON.stringify(at(e).flags));
  const se2 = (BOILERPLATES as Boilerplate[]).find((b) => b.name === 'scaffold-eth-2')!;
  const own = (k: number) => [...Array(k)].map((_, i) => `packages/nextjs/app/mine/page${i}.tsx`);
  const forty = used();
  forty.code = await starterCode([...se2.paths, ...own(40)]);
  assert.equal(forty.code.template_name, 'scaffold-eth-2');
  assert.ok(forty.code.template_overlap! > 0.7);
  assert.equal(at(forty).tier, 'used');
  const three = used();
  three.code = await starterCode([...se2.paths, ...own(3)]);
  flagged('template', three);
});

test('starter forks, read for real: 5 commits ahead of scaffold-eth-2 is flagged, 25 is not', async () => {
  const fork = { full_name: 'scaffold-eth/scaffold-eth-2', default_branch: 'main' };
  const ahead = async (n: number) => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/compare/')) return Response.json({ ahead_by: n, commits: [] });
      if (url.includes('/commits?per_page=1')) return Response.json([{}], { headers: { link: '<https://api.github.com/x?per_page=1&page=900>; rel="last"' } });
      return url.includes('/search/issues') ? Response.json({ total_count: 0, items: [] }) : Response.json([]);
    }) as typeof fetch;
    const read = {
      repo: { full_name: 'a/b', html_url: '', homepage: null, default_branch: 'main', created_at: '2025-01-01T00:00:00Z', pushed_at: daysAgo(3), fork: true, parent: fork },
      tree: [{ path: 'src/index.ts', type: 'blob' }], readme: null, files: [], first_commit_at: '2022-01-01T00:00:00Z', partial: false,
    };
    const e = used();
    e.code = await readCode(read, { gh: f, now: NOW, budget: { remaining: null, stopped: false } });
    return e;
  };
  const five = await ahead(5);
  assert.equal(five.code!.commits_own, 5);
  flagged('fork', five);
  assert.equal(at(await ahead(25)).tier, 'used');
});

test('only counted contracts place; one not counted is shown with its reason', () => {
  const e = used();
  e.onchain = [
    contract({ address: `0x${'ab'.repeat(20)}`, tx_90d: 90_000, senders_90d: 5_000, funded_senders_90d: 50, funded_sample: 50, counted: false, counted_reason: 'named in the repo, not counted' }),
  ];
  const p = at(e);
  assert.equal(p.tier, 'live');
  assert.equal(p.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 0.');
  assert.ok(p.because.includes('0xabab...abab on Base: named in the repo, not counted'), p.because.join(' | '));
  e.onchain.push(contract({ tx_90d: 40, funded_senders_90d: 30, funded_sample: 40 }));
  assert.equal(at(e).tier, 'used');
  const none = at(evidence({ onchain: [{ ...e.onchain[0] }] }));
  assert.equal(none.tier, 'unverified');
  assert.ok(none.because.includes('no counted mainnet contract'), none.because.join(' | '));
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
  assert.ok(p.because.some((b) => b.includes('5 of 50') && b.includes('wallets the deployer did not fund')), p.because.join(' | '));
  assert.equal(p.next, 'At least 20% of sampled wallets not funded by the deployer; 5 of 50 are.');
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

test('the program\'s own earlier screens show in because, never as a flag; zero says nothing (L15-11)', () => {
  const xp = (n: number) => ({ ...X, xp: { applications_90d: n, outcomes: { won: 0, rejected: n } } });
  const seen = at(used(), xp(7));
  assert.equal(seen.tier, 'used');
  assert.deepEqual(seen.flags, []);
  assert.ok(seen.because.includes('seen in 7 earlier screens of this program in 90 days'));
  assert.ok(at(used(), xp(1)).because.includes('seen in 1 earlier screen of this program in 90 days'));
  assert.ok(!at(used(), xp(0)).because.some((b) => b.startsWith('seen in')));
});

test('L15-6: the usage row names what it counts, senders the deployer did not fund', () => {
  const p = at(used());
  assert.ok(p.because.includes('30 senders the deployer did not fund on Base mainnet'), p.because.join(' | '));
  assert.ok(!p.because.some((b) => /funded sender/.test(b)));
  const one = used();
  one.onchain = [contract({ tx_90d: 2, senders_90d: 1, funded_senders_90d: 1, funded_sample: 1 })];
  assert.ok(at(one).because.includes('1 sender the deployer did not fund on Base mainnet'), at(one).because.join(' | '));
});

test('L15-7: an empty repo is unverified with "empty repo", never building on its push date', () => {
  const e = evidence({ repo: 'a/empty', code: codeRows({ empty: true, last_push_at: daysAgo(1), commits_90d: 0, commits_60d: 0 }), team: teamRows({ contributors: 0, contributors_90d: 0 }) });
  const p = at(e);
  assert.equal(p.tier, 'unverified');
  assert.deepEqual(p.because, ['no site', 'no mainnet contract read', 'empty repo', 'no flags']);
  assert.equal(p.next, 'Code pushed to your public repo, or a live product EarnKit can read.');
  // A site that loads still makes it live.
  assert.equal(at({ ...e, live: up }).tier, 'live');
});

test('L15-7: verified onchain users on a stale repo are at least building, with the push as the next step', () => {
  const e = evidence({
    repo: 'a/b',
    onchain: [contract({ tx_90d: 80, senders_90d: 60, funded_senders_90d: 50, funded_sample: 50 })],
    code: codeRows({ last_push_at: daysAgo(200), commits_90d: 0 }),
    team: teamRows({ contributors: 2 }),
  });
  const p = at(e);
  assert.equal(p.tier, 'building');
  assert.deepEqual(p.because, ['80 transactions in 90 days on Base mainnet', '50 senders the deployer did not fund on Base mainnet', 'pushed 200 days ago', '2 contributors', 'no flags']);
  assert.equal(p.next, 'A push to the repo in the last 60 days; the last was 200 days ago.');
  assert.equal(p.gap, 'push');
  // With no repo at all, the contract in use is live (no push date to hold against it).
  assert.equal(at(evidence({ onchain: e.onchain })).tier, 'live');
  // Transactions alone (no sender read as outside the deployer) do not.
  assert.equal(at({ ...e, onchain: [contract({ tx_90d: 80, senders_90d: 60, funded_senders_90d: 0, funded_sample: 50 })] }).tier, 'unverified');
});

test('L15-8: a page that loads but says for sale, parked or coming soon is not live', () => {
  for (const [word, row] of [['for sale', 'site is for sale'], ['parked', 'site is parked'], ['coming soon', 'site says coming soon']]) {
    const p = at(evidence({ live: liveRows({ url: 'https://x.example', url_ok: true, placeholder: word }) }));
    assert.equal(p.tier, 'unverified', word);
    assert.equal(p.because[0], row);
  }
});

test('L15-5: the repo row says why there is no repo block', () => {
  const words = (notes: string[], repo: string | null = null) => at(evidence({ repo, notes })).because[2];
  assert.equal(words(['not read: private repo'], 'a/b'), 'private repo');
  assert.equal(words(['not read: private or missing'], 'a/b'), 'repo private or missing');
  assert.equal(words(['repo not read: on GitLab']), 'GitLab repo, not read');
  assert.equal(words(['repo not read: on Bitbucket']), 'Bitbucket repo, not read');
  assert.equal(words(['repo link is an account, not a repo']), 'account link, not a repo');
  assert.equal(words(['not read: github 502'], 'a/b'), 'repo not read');
  assert.equal(words([]), 'no public repo');
});

test('L15-19: contributors are everyone who committed, never 0, and a full list reads as a floor', () => {
  const e = used();
  e.team = teamRows({ contributors: 30, contributors_90d: 5 });
  assert.ok(at(e).because.includes('30 contributors'), at(e).because.join(' | '));
  e.team = teamRows({ contributors: 500, contributors_more: true });
  assert.ok(at(e).because.includes('500+ contributors'));
  e.team = teamRows({ contributors: 0, contributors_90d: 0 });
  assert.ok(!at(e).because.some((b) => /contributor/.test(b)));
  // A row cached before the list was read: the window's count, still never 0.
  e.team = teamRows({ contributors_90d: 2 });
  assert.ok(at(e).because.includes('2 contributors'));
});

test('L15-23: a contract on a chain with no reader is named in the line', () => {
  const e = evidence({ live: up, onchain: [contract({ chain: 'monad', address: `0x${'a'.repeat(40)}`, mainnet: null, is_contract: null, note: 'not read: no explorer for monad', counted: true })] });
  assert.ok(at(e).because.includes('0xaaaa...aaaa on Monad: not read'), at(e).because.join(' | '));
});

test('I1 (v6.1.14 fix round 1): the builder next step names what is counted, senders the deployer did not fund', () => {
  const e = used();
  e.onchain = [contract({ tx_90d: 9, senders_90d: 8, funded_senders_90d: 8, funded_sample: 8 })];
  const p = at(e);
  assert.equal(p.next, '25 senders the deployer did not fund, on mainnet in 90 days; you have 8.');
  assert.doesNotMatch(p.next!, /funded wallets|funded_/);
});
