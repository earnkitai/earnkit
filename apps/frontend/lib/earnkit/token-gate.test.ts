import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerProblem, tokenGate, type GateDeps, type GateInput } from './token-gate';

const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
const ok: Required<GateDeps> = {
  repo: async () => ({ fork: false, hasCommits: true }),
  owner: async () => ({ status: 'ok', text: `payout_wallet: ${W}` }),
  probe: async () => {},
  screen: async () => {},
};
const input: GateInput = { policy: 'encouraged', repoUrl: 'https://github.com/acme/kit', liveUrl: 'https://kit.acme.dev', wallet: '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3' };

test('passes when the repo is real, the live link loads, and the wallet is clean', async () => {
  assert.deepEqual(await tokenGate(input, ok), { ok: true });
});

test('each failure has its own reason, checked in order', async () => {
  const cases: [Partial<typeof input>, Partial<typeof ok>, RegExp][] = [
    [{ policy: 'off' }, {}, /doesn't allow tokens/],
    [{ repoUrl: null }, {}, /public GitHub repo/],
    [{ repoUrl: 'https://gitlab.com/a/b' }, {}, /public GitHub repo/],
    [{}, { repo: async () => { throw new Error('GitHub: /repos/acme/kit not found (or private)'); } }, /isn't public|couldn't check/],
    [{}, { repo: async () => ({ fork: true, hasCommits: true }) }, /fork/],
    [{}, { repo: async () => ({ fork: false, hasCommits: false }) }, /no commits/],
    [{}, { owner: async () => ({ status: 'missing' }) }, /proof the builder owns github\.com\/acme\/kit.*earnkit\.txt/],
    [{}, { owner: async () => ({ status: 'ok', text: 'payout_wallet: 0x' + 'd'.repeat(40) }) }, /doesn't name the creator wallet/],
    [{ liveUrl: null }, {}, /no live link.*call launch_token with live_url/],
    [{}, { probe: async () => { throw new Error('answered 404, not 2xx'); } }, /live link .*404.*call launch_token with live_url/],
    [{}, { screen: async () => { throw new Error("This wallet can't receive prizes on EarnKit."); } }, /wallet/],
  ];
  for (const [i, d, re] of cases) {
    const r = await tokenGate({ ...input, ...i }, { ...ok, ...d });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, re);
  }
});

test('stops at the first failure (no live-link fetch for a fork)', async () => {
  let probed = false;
  await tokenGate(input, { ...ok, repo: async () => ({ fork: true, hasCommits: true }), probe: async () => { probed = true; } });
  assert.equal(probed, false);
});

test('ownership: checked after the repo and before the live link; a proven campaign wallet skips the read', async () => {
  const seen: string[] = [];
  const trace: Required<GateDeps> = {
    repo: async () => { seen.push('repo'); return { fork: false, hasCommits: true }; },
    owner: async () => { seen.push('owner'); return { status: 'ok', text: `payout_wallet: ${W.toLowerCase()}` }; },
    probe: async () => { seen.push('probe'); },
    screen: async () => { seen.push('screen'); },
  };
  assert.deepEqual(await tokenGate(input, trace), { ok: true });
  assert.deepEqual(seen, ['repo', 'owner', 'probe', 'screen']);
  seen.length = 0;
  assert.deepEqual(await tokenGate({ ...input, provenWallet: W.toLowerCase() }, trace), { ok: true });
  assert.deepEqual(seen, ['repo', 'probe', 'screen']);
});

test('ownerProblem: payout_wallet or creator_wallet names the wallet; problems are explained', () => {
  const repo = 'github.com/acme/kit';
  const C = '0x' + 'c'.repeat(40);
  assert.equal(ownerProblem(repo, { status: 'ok', text: `payout_wallet: ${W}` }, W), null);
  assert.equal(ownerProblem(repo, { status: 'ok', text: `payout_wallet: ${W}\ncreator_wallet: ${C}` }, C, W.toLowerCase()), null);
  // A campaign entry with another creator wallet is told to add a creator_wallet line.
  assert.match(ownerProblem(repo, { status: 'ok', text: `payout_wallet: ${W}` }, C, W.toLowerCase())!, new RegExp(`"creator_wallet: ${C}"`));
  assert.match(ownerProblem(repo, { status: 'missing' }, W)!, new RegExp(`"payout_wallet: ${W}"`));
  assert.match(ownerProblem(repo, { status: 'ok', text: 'payout_wallet: nope' }, W)!, /line 1: payout_wallet needs one 0x address/);
  assert.match(ownerProblem(repo, { status: 'error', message: 'it answered 500' }, W)!, /couldn't read earnkit\.txt.*500/);
});
