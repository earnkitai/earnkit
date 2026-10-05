import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersOf,
  bonusEligible,
  campaignEntryProblems,
  recordSubmission,
  submissionDataProblem,
  OTHER_VALUE_MAX,
  entryRules,
  missingAnswersProblem,
  selfEntryProblem,
  verifiedBonusContracts,
} from './projects';
import { sponsorProgramFile } from './sponsor-rules';
import { ProgramFile } from './program-file';
import type { SubmissionRequirement } from './program-file';
import { privateKeyToAccount } from 'viem/accounts';
import { EntryError } from './campaigns';
import { setSanctionsOracle } from './sanctions';
import { entryMessage } from './entry-proof';
import { upsertProgram } from './programs';
import { sql } from './db';
import type { ProgramRow } from './programs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const W = '0x' + 'a'.repeat(40);
const SPONSOR = '0x' + 'b'.repeat(40);

test('selfEntryProblem: the sponsor installation and the sponsor wallet cannot enter', () => {
  const sponsor = { installation_id: 7, sponsor_wallet: SPONSOR };
  assert.equal(
    selfEntryProblem(sponsor, 7, W),
    "You created this campaign, so you can't enter it.",
  );
  assert.equal(
    selfEntryProblem(sponsor, 8, SPONSOR.toUpperCase().replace('0X', '0x')),
    "payout_wallet: that's the sponsor's wallet, which can't enter its own campaign.",
  );
  assert.equal(selfEntryProblem(sponsor, 8, W), null);
  // EarnKit's own campaigns have no sponsor row.
  assert.equal(selfEntryProblem(null, 7, W), null);
});

test('answersOf: strings, lists joined', () => {
  assert.deepEqual(answersOf({ a: 'x', b: ['1', '2'], c: 3, d: null }), {
    a: 'x',
    b: '1, 2',
    c: '3',
  });
});

test('missingAnswersProblem: a sponsor campaign entry must answer every required field', () => {
  const reqs = sponsorProgramFile({
    ref: '0x' + 'a'.repeat(64),
    draft: {
      sponsor_name: 'Acme',
      title: 'Agents',
      what_to_build: 'Build agents.',
      criteria: 'Best one.',
      chains: ['base'],
      token: 'USDC',
      amount: '100',
      winners: 1,
      existing_work: 'allowed',
      ends_at: '2026-12-01T00:00:00Z',
    },
    token: {
      symbol: 'USDC',
      address: '0x' + 'c'.repeat(40),
      decimals: 6,
    } as never,
    amountUnits: 100_000_000n,
    chainId: 8453,
    escrow: '0x' + 'd'.repeat(40),
    baseUrl: 'https://earnkit.com',
    now: new Date('2026-10-01T00:00:00Z'),
  }).submission_requirements as SubmissionRequirement[];
  const project = {
    name: 'Alpha',
    description: 'An agent.',
    repo_url: 'https://github.com/a/alpha',
    live_url: 'https://alpha.app',
  };
  assert.equal(
    missingAnswersProblem(reqs, project, { payout_wallet: W }),
    null,
  );
  assert.equal(
    missingAnswersProblem(
      reqs,
      {
        name: 'Alpha',
        repo_url: 'https://github.com/a/alpha',
        live_url: 'nope',
      },
      { payout_wallet: W },
    ),
    'Missing required answers: description (What it does and who uses it), live_url (Live link: Not a valid link: must be a full https:// link.). ' +
      'Call prepare_submission to see what each needs, then record_submission again.',
  );
  assert.match(
    missingAnswersProblem(reqs, project, {})!,
    /^Missing required answers: payout_wallet \(Payout wallet\)\./,
  );
});

test('entryRules: existing_work decides whether contracts from before the start count', () => {
  assert.deepEqual(entryRules('sponsor', 'allowed'), {
    requireContracts: false,
    allowExisting: true,
  });
  assert.deepEqual(entryRules('sponsor', 'new_work_only'), {
    requireContracts: false,
    allowExisting: false,
  });
  assert.deepEqual(entryRules('earnkit', 'new_work_only'), {
    requireContracts: true,
    allowExisting: false,
  });
  assert.equal(entryRules('sponsor', 'unknown').allowExisting, false);
});

const agentKey = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'); // anvil #2
const PAY = '0x' + 'a'.repeat(40);
const C1 = '0x' + '1'.repeat(40);
const C2 = '0x' + '2'.repeat(40);
const campaignProgram = (): ProgramRow => {
  const f = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/earnkit-campaign-1-base.json'), 'utf8'));
  return {
    ...f, status: 'active', starts_at: new Date('2026-10-05T00:00:00Z'), ends_at: new Date('2099-01-01T00:00:00Z'),
    verified_at: null, created_at: new Date(), opened_at: null, source: 'file', max_award_usd: '100',
    tag: null, token_policy: 'encouraged',
  } as ProgramRow;
};
const entryDeps = (deployer: Record<string, string>) => ({
  status: async () => 'during' as const,
  repoFacts: async () => ({ fork: false, created_at: '2026-10-01T00:00:00Z', pushed_at: '2026-10-06T00:00:00Z' }),
  fetchFile: async () => ({ status: 'ok' as const, text: `payout_wallet: ${PAY}\n` }),
  deployer: { creationTx: async (c: string) => `0x${c.slice(2, 10)}`, txSender: async (h: string) => deployer[h] },
});
const input = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  program_id: 'earnkit-campaign-1-base',
  project: { name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar.example' },
  submission_data: {
    project_name: 'Tip Jar', description: 'Tips for creators', repo_url: 'https://github.com/alice/tipjar',
    live_url: 'https://tipjar.example', contracts: `${C1},${C2}`, payout_wallet: PAY, ...data,
  },
  ...extra,
});

test('v2.4 §2: every problem at once, not the first one', async () => {
  setSanctionsOracle({ chainId: async () => 8453, isSanctioned: async () => false });
  try {
    await assert.rejects(
      campaignEntryProblems(campaignProgram(), input({ description: '', contracts: `${C1},nope`, payout_wallet: '0xAbCdEf0123456789abcdef0123456789ABCDEF00' }) as never, 1, null, entryDeps({})),
      (err: unknown) => {
        assert.ok(err instanceof EntryError);
        assert.match(err.message, /^Fix these, then call record_submission again:\n- /);
        assert.equal(err.problems.length, 3);
        assert.match(err.problems[0], /Missing required answers: description/);
        assert.match(err.problems[1], /contracts: "nope" isn't an address/);
        assert.match(err.problems[2], /payout_wallet: .* wrong checksum/);
        return true;
      },
    );
  } finally {
    setSanctionsOracle(null);
  }
});

test("v2.4 §2: contracts deployed from the agent's own wallet enter with its signature", async () => {
  setSanctionsOracle({ chainId: async () => 8453, isSanctioned: async () => false });
  try {
    const agent = agentKey.address.toLowerCase();
    const deps = entryDeps({ [`0x${C1.slice(2, 10)}`]: agent, [`0x${C2.slice(2, 10)}`]: PAY });
    const P = 'earnkit-campaign-1-base';
    const signature = await agentKey.signMessage({ message: entryMessage(P, 'github.com/alice/tipjar', PAY, [C1, C2]) });
    const ok = await campaignEntryProblems(campaignProgram(), input({}, { deployer_signature: signature }) as never, 1, null, deps);
    assert.deepEqual(ok.entry, { contracts: [C1, C2], payoutWallet: PAY });
    assert.deepEqual(ok.deployers.sort(), [agent, PAY].sort());
    // Ruling 23: the contracts are sorted, so the order they are entered in doesn't matter.
    await campaignEntryProblems(campaignProgram(), input({ contracts: `${C2},${C1}` }, { deployer_signature: signature }) as never, 1, null, deps);
    // A signature for another contract set or another program doesn't prove this entry.
    const notProven = (err: unknown) =>
      err instanceof EntryError && err.problems.some((p) => p.startsWith(`Contract ${C1} was deployed by ${agent}, not by the wallet that signed`));
    const otherSet = await agentKey.signMessage({ message: entryMessage(P, 'github.com/alice/tipjar', PAY, [C1]) });
    await assert.rejects(campaignEntryProblems(campaignProgram(), input({}, { deployer_signature: otherSet }) as never, 1, null, deps), notProven);
    const otherProgram = await agentKey.signMessage({ message: entryMessage('another-campaign', 'github.com/alice/tipjar', PAY, [C1, C2]) });
    await assert.rejects(campaignEntryProblems(campaignProgram(), input({}, { deployer_signature: otherProgram }) as never, 1, null, deps), notProven);
    // Review Focus 2: a signature over the link form, or a checksummed wallet, isn't the entry message.
    const loose = await agentKey.signMessage({ message: `EarnKit entry: https://github.com/Alice/TipJar ${PAY.toUpperCase().replace('0X', '0x')}` });
    await assert.rejects(
      campaignEntryProblems(campaignProgram(), input({}, { deployer_signature: loose }) as never, 1, null, deps),
      (err: unknown) =>
        err instanceof EntryError &&
        err.problems.some((p) =>
          p.startsWith(`Contract ${C1} was deployed by ${agent}, not by the wallet that signed the entry`),
        ) &&
        err.problems.includes(
          `deployer_signature: sign exactly "EarnKit entry: earnkit-campaign-1-base github.com/alice/tipjar ${PAY} ${C1},${C2}" with the wallet that deployed the contracts and pass it as deployer_signature.`,
        ),
    );
    // I5: the default flow (the agent deployed) without a signature: the exact text to sign, never "redeploy".
    await assert.rejects(
      campaignEntryProblems(campaignProgram(), input({}) as never, 1, null, deps),
      (err: unknown) => {
        assert.ok(err instanceof EntryError);
        assert.deepEqual(err.problems, [
          `Contract ${C1} was deployed by ${agent}, not by your payout wallet.`,
          `deployer_signature: sign exactly "${entryMessage(P, 'github.com/alice/tipjar', PAY, [C1, C2])}" with the wallet that deployed the contracts and pass it as deployer_signature.`,
        ]);
        assert.doesNotMatch(err.message, /redeploy|deployed from your payout wallet/i);
        return true;
      },
    );
  } finally {
    setSanctionsOracle(null);
  }
});

/** entryDeps that count every chain and explorer read. */
const countingDeps = () => {
  const calls = { status: 0, creationTx: 0, txSender: 0 };
  const d = entryDeps({});
  return {
    calls,
    deps: {
      ...d,
      status: async () => (calls.status++, 'during' as const),
      deployer: {
        creationTx: async (c: string) => (calls.creationTx++, `0x${c.slice(2, 10)}`),
        txSender: async () => (calls.txSender++, PAY),
      },
    },
  };
};

test('fix I1: more than 5 contracts read nothing from Base or the explorer', async () => {
  setSanctionsOracle({ chainId: async () => 8453, isSanctioned: async () => false });
  try {
    const many = Array.from({ length: 8 }, (_, i) => '0x' + String(i + 1).repeat(40)).join(',');
    const { calls, deps } = countingDeps();
    await assert.rejects(
      campaignEntryProblems(campaignProgram(), input({ contracts: many }) as never, 1, null, deps),
      (err: unknown) => err instanceof EntryError && err.problems.some((p) => /give 1 to 5 Base contract addresses/.test(p)),
    );
    assert.deepEqual(calls, { status: 0, creationTx: 0, txSender: 0 });
  } finally {
    setSanctionsOracle(null);
  }
});

test('fix I1: submission_data is capped at 50 keys and 4 KB a value, before any read', async () => {
  const { calls, deps } = countingDeps();
  const keys = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'x']));
  await assert.rejects(
    campaignEntryProblems(campaignProgram(), input(keys) as never, 1, null, deps),
    (err: unknown) => err instanceof EntryError && /^submission_data: at most 50 answers/.test(err.message),
  );
  await assert.rejects(
    campaignEntryProblems(campaignProgram(), input({ description: 'x'.repeat(4097) }) as never, 1, null, deps),
    (err: unknown) => err instanceof EntryError && /^submission_data: description is over 4 KB/.test(err.message),
  );
  assert.deepEqual(calls, { status: 0, creationTx: 0, txSender: 0 });
  assert.equal(submissionDataProblem({ a: 'x'.repeat(4096), b: ['y'] }), null);
  // M4: other programs allow 16 KB an answer (an essay already submitted elsewhere).
  assert.equal(submissionDataProblem({ essay: 'x'.repeat(16_384) }, OTHER_VALUE_MAX), null);
  assert.match(submissionDataProblem({ essay: 'x'.repeat(16_385) }, OTHER_VALUE_MAX)!, /^submission_data: essay is over 16 KB/);
});

test('fix minor: a missing repo is reported with the other missing answers', async () => {
  setSanctionsOracle({ chainId: async () => 8453, isSanctioned: async () => false });
  try {
    const i = input({ repo_url: undefined, description: '' });
    i.project = { name: 'Tip Jar', live_url: 'https://tipjar.example' } as never;
    await assert.rejects(
      campaignEntryProblems(campaignProgram(), i as never, 1, null, entryDeps({})),
      (err: unknown) =>
        err instanceof EntryError &&
        /Missing required answers: description .*repo_url/.test(err.problems[0]) &&
        err.problems.includes('repo_url: campaign entries need the public GitHub repo of the project.'),
    );
  } finally {
    setSanctionsOracle(null);
  }
});

// ---- v2.5 §3: submission proof for the builder bonus (DB) ------------------------------------

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('bonusEligible: a coin and a checked-out proof, both required', () => {
  assert.equal(bonusEligible({ coin_address: null, submission_proof_ok_at: null }), false);
  assert.equal(bonusEligible({ coin_address: '0x' + 'a'.repeat(40), submission_proof_ok_at: null }), false);
  assert.equal(bonusEligible({ coin_address: null, submission_proof_ok_at: new Date() }), false);
  assert.equal(bonusEligible({ coin_address: '0x' + 'a'.repeat(40), submission_proof_ok_at: new Date() }), true);
});

/** arc-microgrants.json (real submission_proof: dorahacks.io, /buidl/<id>) under a fresh id. */
function proofProgramFile(id: string, overrides: Record<string, unknown> = {}) {
  const f = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../programs/arc-microgrants.json'), 'utf8'),
  );
  return ProgramFile.parse({ ...f, id, ...overrides });
}

async function freshInstallation() {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`proof-test-${process.pid}-${Date.now()}-${Math.random()}`})
    RETURNING id`;
  return id;
}

const proofProject = (n: number) => ({
  name: `Proof Project ${n}`,
  description: 'A tiny app',
  repo_url: `https://github.com/alice/proof-${n}`,
  live_url: `https://proof-${n}.example`,
});

test('record_submission (v2.5 §3): a checked-out proof stores ok_at and no bonus_note', dbTest, async () => {
  const program = proofProgramFile(`t5-ok-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(1);
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      external_submission_url: 'https://dorahacks.io/buidl/555',
    } as never,
    installationId,
    { fetchProof: async () => `See the repo: ${project.repo_url}` },
  );
  assert.equal(result.recorded, true);
  assert.equal((result as { bonus_note?: string }).bonus_note, undefined);
  const [row] = await sql()<{ submission_proof_url: string | null; submission_proof_ok_at: Date | null; coin_address: string | null }[]>`
    SELECT submission_proof_url, submission_proof_ok_at, coin_address FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_proof_url, 'https://dorahacks.io/buidl/555');
  assert.ok(row.submission_proof_ok_at instanceof Date);
  // No coin launched in this call: not yet bonus-eligible even though the proof checked out.
  assert.equal(bonusEligible(row), false);
});

test('record_submission (v2.5 §3): a failed proof never fails the entry; it notes what to fix', dbTest, async () => {
  const program = proofProgramFile(`t5-fail-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(2);
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      external_submission_url: 'https://dorahacks.io/buidl/556',
    } as never,
    installationId,
    { fetchProof: async () => 'a page about something else entirely' },
  );
  assert.equal(result.recorded, true);
  assert.match((result as { bonus_note?: string }).bonus_note ?? '', /Builder bonus not available yet/);
  const [row] = await sql()<{ submission_proof_url: string | null; submission_proof_ok_at: Date | null }[]>`
    SELECT submission_proof_url, submission_proof_ok_at FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_proof_url, 'https://dorahacks.io/buidl/556');
  assert.equal(row.submission_proof_ok_at, null);
});

test('record_submission (v2.5 §3): no external_submission_url notes it, still records the entry', dbTest, async () => {
  const program = proofProgramFile(`t5-nourl-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(3);
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
    } as never,
    installationId,
  );
  assert.equal(result.recorded, true);
  assert.match((result as { bonus_note?: string }).bonus_note ?? '', /No external_submission_url was given/);
  const [row] = await sql()<{ submission_proof_url: string | null; submission_proof_ok_at: Date | null }[]>`
    SELECT submission_proof_url, submission_proof_ok_at FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_proof_url, null);
  assert.equal(row.submission_proof_ok_at, null);
});

test('record_submission (v2.5 §3): a program without submission_proof never checks or notes anything', dbTest, async () => {
  const program = proofProgramFile(`t5-noproof-${process.pid}-${Date.now()}`, { submission_proof: null });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(4);
  let fetchCalled = false;
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      external_submission_url: 'https://dorahacks.io/buidl/557',
    } as never,
    installationId,
    { fetchProof: async () => ((fetchCalled = true), 'x') },
  );
  assert.equal(result.recorded, true);
  assert.equal((result as { bonus_note?: string }).bonus_note, undefined);
  assert.equal(fetchCalled, false);
  const [row] = await sql()<{ submission_proof_url: string | null; submission_proof_ok_at: Date | null }[]>`
    SELECT submission_proof_url, submission_proof_ok_at FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_proof_url, null);
  assert.equal(row.submission_proof_ok_at, null);
});

// ---- v2.5 Ruling 13: external entries' contracts and one eligible entry per repo ----------------

test('bonusEligible: a later entry of the same repo is never eligible (Ruling 13b)', () => {
  const ok = { coin_address: '0x' + 'a'.repeat(40), submission_proof_ok_at: new Date() };
  assert.equal(bonusEligible({ ...ok, earlier_same_repo: false }), true);
  assert.equal(bonusEligible({ ...ok, earlier_same_repo: true }), false);
});

const OTHER = '0x' + 'b'.repeat(40);
const SIGNER_KEY = ('0x' + '42'.repeat(32)) as `0x${string}`;
const signer = privateKeyToAccount(SIGNER_KEY);
const REPO = 'https://github.com/alice/tipjar';
const byTx = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([c, d]) => [`0x${c.slice(2, 10)}`, d]));

test('verifiedBonusContracts (Ruling 13a): each contract checked like a v2.4 entry; unverified ones dropped with a note', async () => {
  // Both deployed by the payout wallet: both count.
  const both = await verifiedBonusContracts('p', REPO, PAY, [C1, C2.toUpperCase().replace('0X', '0x')], undefined, entryDeps(byTx({ [C1]: PAY, [C2]: PAY })));
  assert.deepEqual(both, { contracts: [C1, C2], deployers: [PAY], note: null });
  // One deployed by another wallet, no signature: that one is dropped, and the note says what to sign.
  const one = await verifiedBonusContracts('p', REPO, PAY, [C1, C2], undefined, entryDeps(byTx({ [C1]: PAY, [C2]: OTHER })));
  assert.deepEqual(one.contracts, [C1]);
  assert.match(one.note ?? '', /Contract 0x2{40} was deployed by 0xb{40}/);
  assert.match(one.note ?? '', /EarnKit entry: p github\.com\/alice\/tipjar/);
  // That wallet signed the entry message: both count.
  const sig = await signer.signMessage({ message: entryMessage('p', 'github.com/alice/tipjar', PAY, [C1, C2]) });
  const signed = await verifiedBonusContracts('p', REPO, PAY, [C1, C2], sig, entryDeps(byTx({ [C1]: PAY, [C2]: signer.address.toLowerCase() })));
  assert.deepEqual(signed.contracts, [C1, C2]);
  assert.deepEqual(new Set(signed.deployers), new Set([PAY, signer.address.toLowerCase()]));
  // earnkit.txt names another wallet: nothing counts.
  const file = await verifiedBonusContracts('p', REPO, PAY, [C1], undefined, {
    ...entryDeps(byTx({ [C1]: PAY })),
    fetchFile: async () => ({ status: 'ok' as const, text: `payout_wallet: ${OTHER}\n` }),
  });
  assert.deepEqual(file.contracts, []);
  assert.match(file.note ?? '', /says payout_wallet/);
});

test('verifiedBonusContracts: Clanker/Uniswap contracts are never accepted; no wallet or a failed read drops them; never throws', async () => {
  const pool = '0x498581fF718922c3f8e6A244956aF099B2652b2b';
  const r = await verifiedBonusContracts('p', REPO, PAY, [pool, C1], undefined, entryDeps(byTx({ [C1]: PAY })));
  assert.deepEqual(r.contracts, [C1]);
  assert.match(r.note ?? '', /Clanker or Uniswap contracts never count/);
  const noWallet = await verifiedBonusContracts('p', REPO, undefined, [C1], undefined, entryDeps({}));
  assert.deepEqual(noWallet.contracts, []);
  assert.match(noWallet.note ?? '', /pass payout_wallet/);
  const noRepo = await verifiedBonusContracts('p', undefined, PAY, [C1], undefined, entryDeps({}));
  assert.match(noRepo.note ?? '', /repo_url/);
  const bad = await verifiedBonusContracts('p', REPO, PAY, ['0x123'], undefined, entryDeps({}));
  assert.match(bad.note ?? '', /isn't a Base contract address/);
  const down = await verifiedBonusContracts('p', REPO, PAY, [C1], undefined, {
    ...entryDeps({}),
    repoFacts: async () => {
      throw new Error('socket hang up');
    },
  });
  assert.deepEqual(down.contracts, []);
  assert.ok(down.note);
});

test('record_submission (Ruling 13): external contracts verified and stored; unverified dropped; a later same-repo entry is noted', dbTest, async () => {
  const program = proofProgramFile(`t6-contracts-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = { ...proofProject(9), repo_url: REPO };
  const submit = (contracts: string[], deployers: Record<string, string>) =>
    recordSubmission(
      {
        program_id: program.id,
        project,
        submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
        external_submission_url: 'https://dorahacks.io/buidl/901',
        contracts,
        payout_wallet: PAY,
      } as never,
      installationId,
      { ...entryDeps(byTx(deployers)), fetchProof: async () => `See ${REPO}` },
    );
  const first = await submit([C1, C2], { [C1]: PAY, [C2]: OTHER });
  assert.equal(first.recorded, true);
  assert.match((first as { bonus_note?: string }).bonus_note ?? '', /Contracts not counted for the builder bonus/);
  const [row] = await sql()<{ contracts: string[] | null; deployers: string[] | null; creator_wallet: string | null; bonus_repo_key: string | null }[]>`
    SELECT contracts, deployers, creator_wallet, bonus_repo_key FROM projects WHERE id = ${first.project_id}`;
  assert.deepEqual(row, { contracts: [C1], deployers: [PAY], creator_wallet: PAY, bonus_repo_key: 'github.com/alice/tipjar' });

  // The first entry isn't eligible yet (no coin): it holds neither the repo nor its contract (Ruling 15).
  const second = await submit([C1], { [C1]: PAY });
  assert.equal(second.recorded, true);
  assert.doesNotMatch((second as { bonus_note?: string }).bonus_note ?? '', /already holds this repo|already backs/);

  // Once the first is eligible (coin + proof), a later entry of the repo and contract is noted.
  // A fresh coin address each run (this file's rows stay in the test DB).
  const coin = '0x' + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await sql()`UPDATE projects SET coin_address = ${coin} WHERE id = ${first.project_id}`;
  const third = await submit([C1], { [C1]: PAY });
  assert.equal(third.recorded, true, 'a later entry of the same repo is still recorded');
  const note = (third as { bonus_note?: string }).bonus_note ?? '';
  assert.match(note, new RegExp(`entry #${first.project_id} already holds this repo`));
  assert.match(note, new RegExp(`${C1} already backs entry #${first.project_id}`));
});

test('verifiedBonusContracts (Ruling 15): the signature covers the list as submitted; refused addresses are named', async () => {
  const pool = '0x498581ff718922c3f8e6a244956af099b2652b2b';
  const deployed = byTx({ [C1]: signer.address.toLowerCase() });
  // Signed over [C1, pool], exactly as submitted: valid, so C1 counts; the note names the pool.
  const sig = await signer.signMessage({ message: entryMessage('p', 'github.com/alice/tipjar', PAY, [C1, pool]) });
  const r = await verifiedBonusContracts('p', REPO, PAY, [C1, pool], sig, entryDeps(deployed));
  assert.deepEqual(r.contracts, [C1]);
  assert.match(r.note ?? '', new RegExp(`${pool}: Clanker or Uniswap contracts never count as yours; leave them out of contracts and sign the list without them`));
  // A signature over the list without the pool doesn't match what was submitted.
  const without = await signer.signMessage({ message: entryMessage('p', 'github.com/alice/tipjar', PAY, [C1]) });
  const w = await verifiedBonusContracts('p', REPO, PAY, [C1, pool], without, entryDeps(deployed));
  assert.deepEqual(w.contracts, []);
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
