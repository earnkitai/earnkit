import { test } from 'node:test';
import type { FetchResult } from './ownership';
import assert from 'node:assert/strict';
import { ForkCheckError } from './match-projects';
import {
  PROOF_LINE_PREFIX,
  codeProblem,
  legacyTokenLineCode,
  ownerProblem,
  tokenCode,
  tokenGate,
  tokenLineFor,
  type GateDeps,
  type GateInput,
} from './token-gate';

process.env.EARNKIT_AUTH_SECRET = 'gate-test-secret';
const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
const REPO = 'https://github.com/acme/kit';
// The line EarnKit gives installation 1 for acme/kit, any ticker.
const LINE = tokenLineFor(1, REPO)!;
const ok: Required<GateDeps> = {
  repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
  owner: async () => ({ status: 'ok', text: LINE }),
  latest: async () => null,
  screen: async () => {},
};
const input: GateInput = { policy: 'encouraged', repoUrl: REPO, wallet: W, symbol: 'KIT', installationId: 1 };

test('passes when the repo has code, earnkit.txt has the line, and the wallet is clean', async () => {
  assert.deepEqual(await tokenGate(input, ok), { ok: true });
});

test('v2.6: the token line is ticker-free and bound to the agent and the repo only', () => {
  assert.match(tokenLineFor(1, REPO)!, /^token: [0-9a-f]{16}$/);
  assert.equal(tokenLineFor(1, REPO), tokenLineFor(1, 'https://github.com/ACME/kit.git'), 'normalized repo');
  assert.notEqual(tokenLineFor(1, REPO), tokenLineFor(2, REPO));
  assert.notEqual(tokenLineFor(1, REPO), tokenLineFor(1, 'https://github.com/acme/other'));
  assert.notEqual(tokenCode(1, REPO), tokenCode(1, REPO, 'another-secret'));
});

test('v2.6: a ticker change needs no new push; no wallet line and no live link needed', async () => {
  assert.deepEqual(await tokenGate({ ...input, symbol: 'NEWT' }, ok), { ok: true });
  assert.deepEqual(await tokenGate({ ...input, liveUrl: null } as GateInput, ok), { ok: true });
});

test('Ruling 1 (plan): a v2.5 "token: <SYMBOL> <code>" line still proves a launch of that ticker', async () => {
  const legacy = `token: KIT ${legacyTokenLineCode(1, REPO, 'KIT')}`;
  const owner = async () => ({ status: 'ok' as const, text: `payout_wallet: ${W}\n${legacy}` });
  assert.deepEqual(await tokenGate({ ...input, symbol: 'KIT' }, { ...ok, owner }), { ok: true });
  // Ticker case-insensitive, as in v2.5.
  assert.deepEqual(await tokenGate({ ...input, symbol: 'kit' }, { ...ok, owner }), { ok: true });
  const other = await tokenGate({ ...input, symbol: 'NEWT' }, { ...ok, owner });
  assert.equal(other.ok, false);
  // M7: the exact line is for the agent only; the builder's reason is plain.
  assert.match((other as { agent_note: string }).agent_note, new RegExp(`"${tokenLineFor(1, REPO)}"`));
  assert.doesNotMatch((other as { reason: string }).reason, /\b(add|edit|create) (a |the )?file\b|\bpush it\b|earnkit\.txt|token:/i);
  // Another installation's legacy line proves nothing.
  const theirs = `token: KIT ${legacyTokenLineCode(2, REPO, 'KIT')}`;
  assert.equal((await tokenGate(input, { ...ok, owner: async () => ({ status: 'ok', text: theirs }) })).ok, false);
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
    [{ repoUrl: null }, {}, /public GitHub repo/],
    [{ repoUrl: 'https://gitlab.com/a/b' }, {}, /public GitHub repo/],
    [{}, { repo: async () => { throw new Error('GitHub: /repos/acme/kit not found (or private)'); } }, /isn't public on GitHub\. Make it public, then say 'launch the token'\./],
    [{}, { repo: async () => { throw new Error('GitHub request failed (502)'); } }, /couldn't check the repo on GitHub right now\. Try again in a minute: say 'launch the token'\.$/],
    // A failed fork compare is not "isn't public", even when the compare says not found.
    [{}, { repo: async () => { throw new ForkCheckError("GitHub: couldn't compare the fork with its parent (GitHub: /repos/x/y/compare not found (or private))", 404); } }, /^EarnKit couldn't check the fork's commits on GitHub right now\. Try again in a minute: say 'launch the token'\.$/],
    [{}, { repo: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }) }, /no commits/],
    [{}, { repo: async () => ({ fork: true, hasCommits: true, aheadOfParent: 0 }) }, /fork with no new commits; a token needs your own code\. Push your own commits to it, then say 'launch the token'\./],
    [{}, { owner: async () => ({ status: 'missing' }) }, /^I need to add a short proof line to your repo first, then say 'launch the token'\.$/],
    [{}, { owner: async () => ({ status: 'ok', text: `payout_wallet: ${W}` }) }, /^I need to add a short proof line to your repo first, then say 'launch the token'\.$/],
    [{}, { owner: async () => ({ status: 'error', message: "GitHub didn't answer" }) }, /^EarnKit couldn't read your repo's proof line on GitHub right now\. Try again in a minute: say 'launch the token'\.$/],
    [{}, { screen: async () => { throw new Error("This wallet can't receive prizes on EarnKit."); } }, /wallet/],
  ];
  for (const [i, d, re] of cases) {
    const r = await tokenGate({ ...input, ...i }, { ...ok, ...d });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, re);
  }
});

test('order: repo, then earnkit.txt, then the screen; stops at the first failure', async () => {
  const seen: string[] = [];
  const trace: Required<GateDeps> = {
    repo: async () => { seen.push('repo'); return { fork: false, hasCommits: true, aheadOfParent: null }; },
    owner: async () => { seen.push('owner'); return { status: 'ok', text: LINE.toUpperCase().replace('TOKEN', 'token') }; },
    latest: async () => { seen.push('latest'); return null; },
    screen: async () => { seen.push('screen'); },
  };
  assert.deepEqual(await tokenGate(input, trace), { ok: true }, 'an uppercased code still matches');
  assert.deepEqual(seen, ['repo', 'owner', 'screen']);
  seen.length = 0;
  await tokenGate(input, { ...trace, repo: async () => { seen.push('repo'); return { fork: true, hasCommits: true, aheadOfParent: 0 }; } });
  assert.deepEqual(seen, ['repo'], 'a fork without new commits never reads earnkit.txt');
});

test('ownerProblem: only the token line counts; wallet lines and their problems are campaign business', () => {
  const repo = 'github.com/acme/kit';
  const code = tokenCode(1, REPO)!;
  const file = (text: string) => ({ status: 'ok' as const, text });
  assert.equal(ownerProblem(repo, file(LINE), code, null), null);
  assert.equal(ownerProblem(repo, file(`payout_wallet: nope\ntoken:   ${code}   # mine\ntoken: OLD 0123456789`), code, null), null);
  // Final review M7: the builder's reason never names the file or the line; the agent note has both.
  const mismatch = ownerProblem(repo, file(`payout_wallet: ${W}\ntoken: KIT 0123456789`), code, null)!;
  const missing = ownerProblem(repo, { status: 'missing' }, code, null)!;
  for (const p of [mismatch, missing]) {
    assert.equal(p.reason, "I need to add a short proof line to your repo first, then say 'launch the token'.");
    assert.doesNotMatch(p.reason, /\b(add|edit|create) (a |the )?file\b|\bpush it\b|earnkit\.txt|token:/i);
    assert.ok(p.agent_note!.endsWith(`Write the line "${LINE}" to earnkit.txt at the root of ${repo} on the default branch and push it yourself; never ask the builder to edit files. Then call launch_token.`), p.agent_note);
  }
  // v2.8.1 §A3: exactly what was found.
  assert.match(missing.agent_note!, /^earnkit\.txt isn't on the default branch\. /);
  assert.match(mismatch.agent_note!, /^earnkit\.txt on the default branch has a token line, but not this agent's code for this repo/);
  assert.match(ownerProblem(repo, file(`payout_wallet: ${W}`), code, null)!.agent_note!, /^earnkit\.txt on the default branch has no token line\. /);
  const err = ownerProblem(repo, { status: 'error', message: "GitHub didn't answer" }, code, null)!;
  assert.doesNotMatch(err.reason, /earnkit\.txt/);
  assert.match(err.agent_note!, /earnkit\.txt in github\.com\/acme\/kit: GitHub didn't answer/);
  // A code one character off, or on a ticker line, fails.
  const off = code.slice(0, 15) + (code[15] === '0' ? '1' : '0');
  assert.notEqual(ownerProblem(repo, file(`token: ${off}`), code, null), null);
  assert.notEqual(ownerProblem(repo, file(`token: KIT ${code}`), code, null), null);
});

test('the token line is bound to the agent: a copied line fails; no secret fails closed', async () => {
  const file = (line: string) => ({ ...ok, owner: async () => ({ status: 'ok' as const, text: line }) });
  assert.deepEqual(await tokenGate(input, file(LINE)), { ok: true });
  // The owner's line, copied by another installation, fails for that installation.
  const copied = await tokenGate({ ...input, installationId: 2 }, file(LINE));
  assert.equal(copied.ok, false);
  assert.match((copied as { agent_note: string }).agent_note, new RegExp(`"${tokenLineFor(2, REPO)}"`));
  // The same agent's line for another repo fails here.
  assert.equal((await tokenGate(input, file(tokenLineFor(1, 'https://github.com/acme/other')!))).ok, false);
  // No EARNKIT_AUTH_SECRET: fail closed, the file isn't even read.
  const saved = process.env.EARNKIT_AUTH_SECRET;
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    let read = false;
    const r = await tokenGate(input, { ...ok, owner: async () => { read = true; return { status: 'ok', text: LINE }; } });
    assert.deepEqual(r, { ok: false, reason: "Token launches aren't configured right now." });
    assert.equal(read, false);
    assert.equal(tokenLineFor(1, REPO), null);
  } finally {
    process.env.EARNKIT_AUTH_SECRET = saved;
  }
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
    [{}, { owner: async () => ({ status: 'missing' }) }],
    [{}, { owner: async () => ({ status: 'ok', text: '' }) }],
    [{}, { owner: async () => ({ status: 'error', message: "GitHub didn't answer" }) }],
  ];
  for (const [i, d] of fails) {
    const r = await tokenGate({ ...input, ...i }, { ...ok, ...d });
    assert.equal(r.ok, false);
    reasons.push((r as { reason: string }).reason);
  }
  for (const r of reasons) {
    assert.match(r, /say 'launch the token'\.$/, r);
    // v2.7 §4: "coin" became "token" everywhere, so the old regression guard against the pre-fix
    // "A token needs ... call launch_token with repo_url" wording is now this exact phrase, not the
    // bare "A token needs" start (which the renamed, correct reason now legitimately has).
    assert.doesNotMatch(r, /call launch_token|\b[2-5]\d\d\b|A token needs the project's public GitHub repo: call/, r);
  }
});

test('v2.8.1 §A3: the default branch first; else the most recently pushed branch proves it; the guidance names both', async () => {
  const seen: string[] = [];
  const deps = (def: FetchResult, latest: { branch: string; file: FetchResult } | null): Required<GateDeps> => ({
    ...ok,
    repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main' }),
    owner: async () => { seen.push('owner'); return def; },
    latest: async (_r, branch) => { seen.push(`latest:${branch}`); return latest; },
  });
  // On the default branch: the branch read never runs.
  assert.deepEqual(await tokenGate(input, deps({ status: 'ok', text: LINE }, null)), { ok: true });
  assert.deepEqual(seen, ['owner']);
  // Only on the feature branch the agent pushed: it proves the launch (one more read).
  seen.length = 0;
  assert.deepEqual(await tokenGate(input, deps({ status: 'missing' }, { branch: 'feat/x', file: { status: 'ok', text: LINE } })), { ok: true });
  assert.deepEqual(seen, ['owner', 'latest:main']);
  // Neither: the builder hears the branch; the agent hears what was found where.
  const no = (await tokenGate(input, deps({ status: 'missing' }, { branch: 'feat/x', file: { status: 'ok', text: 'token: KIT 0123456789' } }))) as {
    ok: false; reason: string; agent_note: string; branch?: string; fixable?: true;
  };
  assert.equal(no.ok, false);
  assert.equal(no.fixable, true);
  assert.equal(no.branch, 'main');
  assert.equal(no.reason, "I need to add a short proof line to your repo's main branch first, then say 'launch the token'.");
  assert.ok(no.reason.startsWith(PROOF_LINE_PREFIX));
  assert.equal(
    no.agent_note,
    "earnkit.txt isn't on the default branch (main); earnkit.txt on the most recently pushed branch (feat/x) has a token line, but not this agent's code for this repo (another agent's, or an old one). " +
      `Write the line "${LINE}" to earnkit.txt at the root of github.com/acme/kit on the default branch (main) and push it yourself; never ask the builder to edit files. Then call launch_token.`,
  );
  // A default-branch read error with no other branch stays the "try again" error.
  const err = (await tokenGate(input, deps({ status: 'error', message: "GitHub didn't answer" }, null))) as { ok: false; reason: string };
  assert.match(err.reason, /couldn't read your repo's proof line on GitHub right now/);
  // A branch name that isn't plain is never echoed.
  const odd = (await tokenGate(input, deps({ status: 'missing' }, { branch: 'x"; rm', file: { status: 'missing' } }))) as { agent_note: string };
  assert.match(odd.agent_note, /most recently pushed branch \(another branch\)/);
});
