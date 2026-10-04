import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerProblem,
  tokenGate,
  tokenLineCode,
  tokenLineFor,
  type GateDeps,
  type GateInput,
} from './token-gate';

process.env.EARNKIT_AUTH_SECRET = 'gate-test-secret';
const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
const REPO = 'https://github.com/acme/kit';
// The line EarnKit gives installation 1 for $KIT from acme/kit.
const LINE = tokenLineFor(1, REPO, 'KIT')!;
const ok: Required<GateDeps> = {
  repo: async () => ({ fork: false, hasCommits: true }),
  owner: async () => ({ status: 'ok', text: `payout_wallet: ${W}\n${LINE}` }),
  probe: async () => {},
  screen: async () => {},
};
const input: GateInput = { policy: 'encouraged', repoUrl: 'https://github.com/acme/kit', liveUrl: 'https://kit.acme.dev', wallet: '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3', symbol: 'KIT', installationId: 1 };

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
    [{}, { owner: async () => ({ status: 'ok', text: 'payout_wallet: 0x' + 'd'.repeat(40) + `\n${LINE}` }) }, /doesn't name the creator wallet/],
    [{}, { owner: async () => ({ status: 'ok', text: `payout_wallet: ${W}` }) }, new RegExp(`Add the line "${LINE}" to earnkit\\.txt at the repo root \\(default branch\\), then call launch_token\\.`)],
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

test('ownership: checked after the repo and before the live link; read for every launch, campaign entries too', async () => {
  const seen: string[] = [];
  const trace: Required<GateDeps> = {
    repo: async () => { seen.push('repo'); return { fork: false, hasCommits: true }; },
    owner: async () => { seen.push('owner'); return { status: 'ok', text: `payout_wallet: ${W.toLowerCase()}\n${LINE.replace('KIT', 'kit')}` }; },
    probe: async () => { seen.push('probe'); },
    screen: async () => { seen.push('screen'); },
  };
  assert.deepEqual(await tokenGate(input, trace), { ok: true });
  assert.deepEqual(seen, ['repo', 'owner', 'probe', 'screen']);
  seen.length = 0;
  assert.deepEqual(await tokenGate({ ...input, provenWallet: W.toLowerCase() }, trace), { ok: true });
  assert.deepEqual(seen, ['repo', 'owner', 'probe', 'screen']);
  // A campaign entry's proven wallet still needs this launch's token line.
  const noLine = await tokenGate({ ...input, provenWallet: W.toLowerCase() }, { ...trace, owner: async () => ({ status: 'ok', text: `payout_wallet: ${W}` }) });
  assert.equal(noLine.ok, false);
  assert.match((noLine as { reason: string }).reason, new RegExp(`"${LINE}"`));
});

test('ownerProblem: the wallet line and the per-launch token line', () => {
  const repo = 'github.com/acme/kit';
  const C = '0x' + 'c'.repeat(40);
  const code = tokenLineCode(1, REPO, 'KIT')!;
  const ok = (text: string) => ({ status: 'ok' as const, text });
  assert.equal(ownerProblem(repo, ok(`payout_wallet: ${W}\n${LINE}`), W, 'KIT', code), null);
  // Symbol case-insensitive, extra whitespace tolerated, other lines allowed.
  assert.equal(ownerProblem(repo, ok(`payout_wallet: ${W}\ntoken:   kit    ${code}  # mine\ntoken: OLD 0123456789`), W, 'kit', code), null);
  assert.equal(ownerProblem(repo, ok(`payout_wallet: ${W}\ncreator_wallet: ${C}\n${LINE}`), C, 'KIT', code, W.toLowerCase()), null);
  // A wallet copied from someone else's file proves nothing without this launch's token line.
  const stealCode = tokenLineCode(2, REPO, 'STEAL')!;
  assert.match(ownerProblem(repo, ok(`payout_wallet: ${W}\ntoken: OLD 0123456789`), W, 'STEAL', stealCode)!, new RegExp(`^Add the line "token: STEAL ${stealCode}"`));
  // Another creator wallet goes on a creator_wallet line, campaign or not, when payout_wallet is taken.
  assert.match(ownerProblem(repo, ok(`payout_wallet: ${W}\n${LINE}`), C, 'KIT', code, W.toLowerCase())!, new RegExp(`"creator_wallet: ${C}"`));
  const other = ownerProblem(repo, ok(`payout_wallet: ${W}`), C, 'KIT', code)!;
  assert.match(other, new RegExp(`add the line "creator_wallet: ${C}" and the line "${LINE}"`));
  assert.doesNotMatch(other, /"payout_wallet: /);
  // No file: both lines.
  assert.match(ownerProblem(repo, { status: 'missing' }, W, 'KIT', code)!, new RegExp(`"payout_wallet: ${W}" and "${LINE}"`));
  assert.match(ownerProblem(repo, ok('payout_wallet: nope'), W, 'KIT', code)!, /line 1: payout_wallet needs one 0x address/);
  // Malformed creator_wallet/token lines are ignored, not problems.
  assert.match(ownerProblem(repo, ok(`payout_wallet: ${W}\ncreator_wallet: nope\ntoken: a b c`), W, 'KIT', code)!, /^Add the line "token: KIT /);
  assert.match(ownerProblem(repo, { status: 'error', message: 'it answered 500' }, W, 'KIT', code)!, /couldn't read earnkit\.txt.*500/);
});

test('the token line is bound to the agent, the repo and the ticker', async () => {
  const code = tokenLineCode(1, REPO, 'KIT')!;
  assert.match(code, /^[0-9a-f]{10}$/);
  // Deterministic; the repo is normalized; the symbol is case-insensitive.
  assert.equal(tokenLineCode(1, 'https://GitHub.com/Acme/Kit.git', 'kit'), code);
  assert.notEqual(tokenLineCode(2, REPO, 'KIT'), code);
  assert.notEqual(tokenLineCode(1, 'https://github.com/acme/other', 'KIT'), code);
  assert.notEqual(tokenLineCode(1, REPO, 'KITS'), code);
  assert.notEqual(tokenLineCode(1, REPO, 'KIT', 'another-secret'), code);
  const file = (line: string) => ({ ...ok, owner: async () => ({ status: 'ok' as const, text: `payout_wallet: ${W}\n${line}` }) });
  // The right code passes.
  assert.deepEqual(await tokenGate(input, file(LINE)), { ok: true });
  // The owner's line, copied by another installation, fails for that installation.
  const copied = await tokenGate({ ...input, installationId: 2 }, file(LINE));
  assert.equal(copied.ok, false);
  assert.match((copied as { reason: string }).reason, new RegExp(`Add the line "${tokenLineFor(2, REPO, 'KIT')}"`));
  // No code, a wrong code, or the code under another ticker fails.
  for (const line of ['token: KIT', `token: KIT ${code.slice(0, 9)}0`, `token: KIT ${code.toUpperCase()}`, `token: KITS ${code}`])
    assert.equal((await tokenGate(input, file(line))).ok, false, line);
  // No EARNKIT_AUTH_SECRET: fail closed, the file isn't even read.
  const saved = process.env.EARNKIT_AUTH_SECRET;
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    let read = false;
    const r = await tokenGate(input, { ...ok, owner: async () => { read = true; return { status: 'ok', text: LINE }; } });
    assert.deepEqual(r, { ok: false, reason: "Token launches aren't configured right now." });
    assert.equal(read, false);
    assert.equal(tokenLineFor(1, REPO, 'KIT'), null);
  } finally {
    process.env.EARNKIT_AUTH_SECRET = saved;
  }
});
