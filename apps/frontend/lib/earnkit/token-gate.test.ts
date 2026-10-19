import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForkCheckError } from './match-projects';
import { appInstallReason, codeProblem, tokenGate, type GateDeps, type GateInput } from './token-gate';

process.env.EARNKIT_AUTH_SECRET = 'gate-test-secret';
const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
const REPO = 'https://github.com/acme/kit';
const LINK = 'https://earnkit.com/github/verify?n=abc';
// v2.14 spec 2: the repo is proven by the read-only App (appProven); nothing is read from earnkit.txt.
const ok: Required<GateDeps> = {
  shared: async () => false,
  appToken: async () => null,
  appLink: async () => LINK,
  repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
  screen: async () => {},
  appProven: async () => true,
};
const input: GateInput = { policy: 'encouraged', repoUrl: REPO, wallet: W, symbol: 'KIT', installationId: 1 };

test('passes when the repo has code, the App proved it, and the wallet is clean', async () => {
  assert.deepEqual(await tokenGate(input, ok), { ok: true });
  // A ticker change needs nothing new.
  assert.deepEqual(await tokenGate({ ...input, symbol: 'NEWT' }, ok), { ok: true });
});

test('Ruling 3 (plan): a repo with real code', () => {
  assert.equal(codeProblem({ fork: false, hasCommits: true, aheadOfParent: null }), null);
  assert.match(codeProblem({ fork: false, hasCommits: false, aheadOfParent: null })!, /no commits/);
  assert.equal(codeProblem({ fork: true, hasCommits: true, aheadOfParent: 3 }), null);
  assert.match(codeProblem({ fork: true, hasCommits: true, aheadOfParent: 0 })!, /fork with no new commits/);
  assert.match(codeProblem({ fork: true, hasCommits: true, aheadOfParent: null })!, /fork with no new commits/);
});

test('each failure has its own reason, checked in order', async () => {
  const cases: [Partial<GateInput>, Partial<GateDeps>, RegExp][] = [
    [{ policy: 'off' }, {}, /doesn't allow tokens/],
    [{ repoUrl: null }, {}, /project's GitHub repo/],
    [{ repoUrl: 'https://gitlab.com/a/b' }, {}, /project's GitHub repo/],
    // v2.14: a repo EarnKit can't see is read and proven through the App: its install link.
    [{}, { repo: async () => { throw new Error('GitHub: /repos/acme/kit not found (or private)'); } }, /read-only EarnKit app is installed on it \(one click\): https:\/\/earnkit\.com\/github\/verify\?n=abc Then say 'launch the token'\./],
    [{}, { repo: async () => { throw new Error('GitHub request failed (502)'); } }, /couldn't check the repo on GitHub right now\. Try again in a minute: say 'launch the token'\.$/],
    // A failed fork compare is not "can't see", even when the compare says not found.
    [{}, { repo: async () => { throw new ForkCheckError("GitHub: couldn't compare the fork with its parent (GitHub: /repos/x/y/compare not found (or private))", 404); } }, /^EarnKit couldn't check the fork's commits on GitHub right now\. Try again in a minute: say 'launch the token'\.$/],
    [{}, { repo: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }) }, /no commits/],
    [{}, { repo: async () => ({ fork: true, hasCommits: true, aheadOfParent: 0 }) }, /fork with no new commits; a token needs your own code\. Push your own commits to it, then say 'launch the token'\./],
    [{}, { appProven: async () => false }, /^EarnKit counts acme\/kit once the read-only EarnKit app is installed on it \(one click\): https:\/\/earnkit\.com\/github\/verify\?n=abc Then say 'launch the token'\.$/],
    [{}, { appProven: async () => { throw new Error('db down'); } }, /read-only EarnKit app/],
    [{}, { appProven: async () => false, appLink: async () => null }, /^EarnKit can count acme\/kit once the read-only EarnKit app is installed on it\. Then say 'launch the token'\.$/],
    [{}, { screen: async () => { throw new Error("This wallet can't receive prizes on EarnKit."); } }, /wallet/],
  ];
  for (const [i, d, re] of cases) {
    const r = await tokenGate({ ...input, ...i }, { ...ok, ...d });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, re);
  }
  assert.equal(appInstallReason('acme/kit', LINK), "EarnKit counts acme/kit once the read-only EarnKit app is installed on it (one click): https://earnkit.com/github/verify?n=abc Then say 'launch the token'.");
});

test('order: repo, then the App proof, then the screen; stops at the first failure', async () => {
  const seen: string[] = [];
  const trace: Required<GateDeps> = {
    ...ok,
    repo: async () => { seen.push('repo'); return { fork: false, hasCommits: true, aheadOfParent: null }; },
    appProven: async () => { seen.push('app'); return true; },
    screen: async () => { seen.push('screen'); },
  };
  assert.deepEqual(await tokenGate(input, trace), { ok: true });
  assert.deepEqual(seen, ['repo', 'app', 'screen']);
  seen.length = 0;
  await tokenGate(input, { ...trace, repo: async () => { seen.push('repo'); return { fork: true, hasCommits: true, aheadOfParent: 0 }; } });
  assert.deepEqual(seen, ['repo'], 'a fork without new commits never checks the proof');
  seen.length = 0;
  await tokenGate(input, { ...trace, appProven: async () => { seen.push('app'); return false; } });
  assert.deepEqual(seen, ['repo', 'app'], 'an unproven repo never screens the wallet');
});

test('fix round 1: every reason is plain, uses one retry form, and never shows an HTTP status', async () => {
  const reasons: string[] = [];
  const fails: [Partial<GateInput>, Partial<GateDeps>][] = [
    [{ repoUrl: null }, {}],
    [{}, { repo: async () => { throw new Error('GitHub: /repos/acme/kit not found (or private)'); } }],
    [{}, { repo: async () => { throw new Error('GitHub request failed (502)'); } }],
    [{}, { repo: async () => { throw new ForkCheckError('GitHub: couldn\'t compare (GitHub request failed (500))', 500); } }],
    [{}, { repo: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }) }],
    [{}, { repo: async () => ({ fork: true, hasCommits: true, aheadOfParent: 0 }) }],
    [{}, { appProven: async () => false }],
    [{}, { appProven: async () => false, appLink: async () => null }],
  ];
  for (const [i, d] of fails) {
    const r = await tokenGate({ ...input, ...i }, { ...ok, ...d });
    assert.equal(r.ok, false);
    reasons.push((r as { reason: string }).reason);
  }
  for (const r of reasons) {
    assert.match(r, /say 'launch the token'\.$/, r);
    assert.doesNotMatch(r, /call launch_token|\b[2-5]\d\d\b|earnkit\.txt|proof line|branch/, r);
  }
});

test('4.11 with the App\'s token a private repo passes the code check; the App proof still decides', async () => {
  const notPublic = () => {
    throw new Error('GitHub: /repos/acme/kit not found (or private)');
  };
  const seen: string[] = [];
  const viaApp: Partial<GateDeps> = {
    appToken: async (key) => (seen.push(`token ${key}`), 'ghs_tok'),
    repo: async (_o, _r, token) => (token === 'ghs_tok' ? { fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main' } : notPublic()),
  };
  assert.deepEqual(await tokenGate(input, { ...ok, ...viaApp }), { ok: true, private: true });
  assert.deepEqual(seen, ['token acme/kit']);
  // A public repo is never read through the App.
  seen.length = 0;
  assert.deepEqual(await tokenGate(input, { ...ok, appToken: viaApp.appToken }), { ok: true });
  assert.deepEqual(seen, []);
  // A token that reads the repo is not a proof by itself.
  const unproven = await tokenGate(input, { ...ok, ...viaApp, appProven: async () => false });
  assert.equal(unproven.ok, false);
  assert.match((unproven as { reason: string }).reason, /read-only EarnKit app/);
});

test('G10: on a shared client only the caller\'s own verified login\'s App proof counts', async () => {
  const asked: (string | null | undefined)[] = [];
  const d: Partial<GateDeps> = { appProven: async (_i, _k, login) => (asked.push(login), login === 'alice') };
  assert.equal((await tokenGate({ ...input, verifiedLogin: 'alice' }, { ...ok, ...d })).ok, true);
  assert.equal((await tokenGate({ ...input, verifiedLogin: null }, { ...ok, ...d })).ok, false);
  // A shared group with no login passed: none (null), never the agent-wide proof.
  assert.equal((await tokenGate(input, { ...ok, ...d, shared: async () => true })).ok, false);
  // Off a shared client: the person's own proof (undefined login).
  assert.equal((await tokenGate(input, { ...ok, ...d, appProven: async (_i, _k, login) => (asked.push(login), login === undefined) })).ok, true);
  assert.deepEqual(asked, ['alice', null, null, undefined]);
});
