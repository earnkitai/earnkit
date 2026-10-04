import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenGate, type GateInput } from './token-gate';

const ok = {
  repo: async () => ({ fork: false, hasCommits: true }),
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
    [{ liveUrl: null }, {}, /no live link/],
    [{}, { probe: async () => { throw new Error('answered 404, not 2xx'); } }, /live link .*404/],
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
