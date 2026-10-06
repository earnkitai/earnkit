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
import { LaunchTokenInput, launchToken } from './token-launch';
import { eligibleSql } from './traction';
import { sponsorProgramFile } from './sponsor-rules';
import { ProgramFile } from './program-file';
import type { SubmissionRequirement } from './program-file';
import { privateKeyToAccount } from 'viem/accounts';
import { EntryError } from './campaigns';
import { setSanctionsOracle } from './sanctions';
import { entryMessage } from './entry-proof';
import { upsertProgram } from './programs';
import { sql } from './db';
import { rememberedWallet } from './installations';
import { roundFor } from './bonus-rounds';
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
  // Ruling 24: the builder is asked for the entry link.
  assert.deepEqual((result as { bonus_join?: unknown }).bonus_join, { kind: 'link', site: 'dorahacks.io' });
  const [row] = await sql()<{ submission_proof_url: string | null; submission_proof_ok_at: Date | null }[]>`
    SELECT submission_proof_url, submission_proof_ok_at FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_proof_url, null);
  assert.equal(row.submission_proof_ok_at, null);
});

test('record_submission (v2.6 §3): a program without a pattern never fetches; without the builder\'s confirmation it says how to count', dbTest, async () => {
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
  assert.match((result as { bonus_note?: string }).bonus_note ?? '', /builder_submitted: true/);
  assert.equal(fetchCalled, false);
  const [row] = await sql()<{ submission_proof_url: string | null; submission_proof_ok_at: Date | null; submission_basis: string | null; submission_confirmed_at: Date | null }[]>`
    SELECT submission_proof_url, submission_proof_ok_at, submission_basis, submission_confirmed_at FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_proof_url, null);
  assert.equal(row.submission_proof_ok_at, null);
  assert.equal(row.submission_basis, null);
  assert.equal(row.submission_confirmed_at, null);
});

test('record_submission (v2.6 Ruling 5): a program without a pattern counts on builder_submitted: true (only true)', dbTest, async () => {
  const program = proofProgramFile(`t5-confirm-${process.pid}-${Date.now()}`, { submission_proof: null });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(5);
  const data = { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' };
  const result = await recordSubmission(
    { program_id: program.id, project, submission_data: data, builder_submitted: true } as never,
    installationId,
  );
  assert.equal((result as { bonus_note?: string }).bonus_note, undefined);
  const [row] = await sql()<{ submission_proof_ok_at: Date | null; submission_basis: string | null; submission_confirmed_at: Date | null }[]>`
    SELECT submission_proof_ok_at, submission_basis, submission_confirmed_at FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_basis, 'confirmed');
  assert.ok(row.submission_proof_ok_at instanceof Date);
  assert.ok(row.submission_confirmed_at instanceof Date);
  // A truthy value that isn't true never counts.
  const loose = await recordSubmission(
    { program_id: program.id, project: proofProject(6), submission_data: data, builder_submitted: 'yes' } as never,
    installationId,
  );
  const [l] = await sql()<{ submission_basis: string | null; submission_confirmed_at: Date | null }[]>`
    SELECT submission_basis, submission_confirmed_at FROM projects WHERE id = ${loose.project_id}`;
  assert.deepEqual([l.submission_basis, l.submission_confirmed_at], [null, null]);
  // An opted-out program never counts a submission.
  const off = proofProgramFile(`t5-confirm-off-${process.pid}-${Date.now()}`, { submission_proof: null, builder_bonus: false });
  await upsertProgram(off);
  const offEntry = await recordSubmission(
    { program_id: off.id, project: proofProject(7), submission_data: data, builder_submitted: true } as never,
    installationId,
  );
  const [o] = await sql()<{ submission_basis: string | null; submission_proof_ok_at: Date | null }[]>`
    SELECT submission_basis, submission_proof_ok_at FROM projects WHERE id = ${offEntry.project_id}`;
  assert.deepEqual([o.submission_basis, o.submission_proof_ok_at], [null, null]);
  assert.equal((offEntry as { bonus_note?: string }).bonus_note, undefined);
});

test('record_submission (v2.6 Ruling 4): a blocked entry page counts on the builder\'s confirmation as an unverified page', dbTest, async () => {
  const { SafeFetchError } = await import('./safe-fetch');
  const program = proofProgramFile(`t5-unv-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(8);
  const data = { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' };
  const blocked = async () => { throw new SafeFetchError('it answered 405'); };
  const result = await recordSubmission(
    { program_id: program.id, project, submission_data: data, external_submission_url: 'https://dorahacks.io/buidl/558', builder_submitted: true } as never,
    installationId,
    { fetchProof: blocked },
  );
  assert.equal((result as { bonus_note?: string }).bonus_note, undefined);
  const [row] = await sql()<{ submission_proof_ok_at: Date | null; submission_proof_checked_at: Date | null; submission_basis: string | null; submission_confirmed_at: Date | null }[]>`
    SELECT submission_proof_ok_at, submission_proof_checked_at, submission_basis, submission_confirmed_at FROM projects WHERE id = ${result.project_id}`;
  assert.equal(row.submission_basis, 'unverified_page');
  assert.ok(row.submission_proof_ok_at instanceof Date);
  assert.ok(row.submission_proof_checked_at instanceof Date);
  assert.ok(row.submission_confirmed_at instanceof Date);
  // Without the confirmation the blocked page doesn't count yet, and the note says how it would.
  const unconfirmed = await recordSubmission(
    { program_id: program.id, project: proofProject(9), submission_data: data, external_submission_url: 'https://dorahacks.io/buidl/559' } as never,
    installationId,
    { fetchProof: blocked },
  );
  assert.match((unconfirmed as { bonus_note?: string }).bonus_note ?? '', /builder_submitted: true/);
  const [u] = await sql()<{ submission_basis: string | null; submission_proof_ok_at: Date | null }[]>`
    SELECT submission_basis, submission_proof_ok_at FROM projects WHERE id = ${unconfirmed.project_id}`;
  assert.deepEqual([u.submission_basis, u.submission_proof_ok_at], [null, null]);
  // A page that loads without the entry's link never counts, confirmed or not.
  const mismatch = await recordSubmission(
    { program_id: program.id, project: proofProject(10), submission_data: data, external_submission_url: 'https://dorahacks.io/buidl/560', builder_submitted: true } as never,
    installationId,
    { fetchProof: async () => 'another team' },
  );
  const [m] = await sql()<{ submission_basis: string | null; submission_proof_ok_at: Date | null; submission_confirmed_at: Date | null }[]>`
    SELECT submission_basis, submission_proof_ok_at, submission_confirmed_at FROM projects WHERE id = ${mismatch.project_id}`;
  assert.deepEqual([m.submission_basis, m.submission_proof_ok_at], [null, null]);
  assert.equal(m.submission_confirmed_at, null, 'I2: a page without the link disproves the confirmation');
  assert.match((mismatch as { bonus_note?: string }).bonus_note ?? '', /doesn't link to your repo yet/);
});

test('record_submission (v2.6 §3): a checked-out page is stored as basis page', dbTest, async () => {
  const program = proofProgramFile(`t5-page-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(11);
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      external_submission_url: 'https://dorahacks.io/buidl/561',
    } as never,
    installationId,
    { fetchProof: async () => `See ${project.repo_url}` },
  );
  const [row] = await sql()<{ submission_basis: string | null; submission_confirmed_at: Date | null }[]>`
    SELECT submission_basis, submission_confirmed_at FROM projects WHERE id = ${result.project_id}`;
  assert.deepEqual([row.submission_basis, row.submission_confirmed_at], ['page', null]);
});

test('Ruling 25 (I8): a repo whose coin is entered in another program is told at record time: no builder bonus here', dbTest, async () => {
  const tag = `fw-coin-${process.pid}-${Date.now()}`;
  const coinProgram = proofProgramFile(`${tag}-a`, { title: 'Coin Home Program' });
  const program = proofProgramFile(`${tag}-b`, { starts_at: '2026-01-01T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' });
  await upsertProgram(coinProgram);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = { ...proofProject(77), repo_url: `https://github.com/alice/${tag}` };
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, installation_id, token_url, token_repo_key, token_status)
    VALUES (${coinProgram.id}, 'Coin home', ${project.repo_url}, ${installationId}, 'https://tokens.fun/coin/0x1', ${`github.com/alice/${tag}`}, 'launched')`;
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      external_submission_url: 'https://dorahacks.io/buidl/577',
    } as never,
    installationId,
    { fetchProof: async () => `See the repo: ${project.repo_url}` },
  );
  assert.equal(result.recorded, true);
  assert.match((result as { bonus_note?: string }).bonus_note ?? '', /No builder bonus: this repo's token is entered in Coin Home Program\./);
});

test('residual m4: a repo whose coin is entered in this SAME program gets no Ruling 25 note', dbTest, async () => {
  const tag = `fw-m4-${process.pid}-${Date.now()}`;
  const program = proofProgramFile(tag, { starts_at: '2026-01-01T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = { ...proofProject(79), repo_url: `https://github.com/alice/${tag}` };
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, installation_id, token_url, token_repo_key, token_status)
    VALUES (${program.id}, 'Same program', ${project.repo_url}, ${installationId}, 'https://tokens.fun/coin/0x2', ${`github.com/alice/${tag}`}, 'launched')`;
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      external_submission_url: 'https://dorahacks.io/buidl/579',
    } as never,
    installationId,
    { fetchProof: async () => `See the repo: ${project.repo_url}` },
  );
  assert.doesNotMatch((result as { bonus_note?: string }).bonus_note ?? '', /this repo's token is entered in/);
});

test('M12: the entry-time note judges an earlier entry by the round rule (coin launched before the end), like scoring', dbTest, async () => {
  const tag = `fw-m12-${process.pid}-${Date.now()}`;
  const program = proofProgramFile(tag, { starts_at: '2026-01-01T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = { ...proofProject(78), repo_url: `https://github.com/alice/${tag}` };
  // An earlier entry of the repo with a coin and a proof, but no launch time before the round's end
  // (eligibleSql never counts it), must not be named as holding the repo.
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, installation_id, bonus_repo_key, coin_address, coin_launched_at, submission_proof_ok_at)
    VALUES (${program.id}, 'Earlier', ${project.repo_url}, ${installationId}, ${`github.com/alice/${tag}`},
      ${`0x${'e'.repeat(36)}${String(process.pid % 10000).padStart(4, '0')}`}, NULL, now())`;
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      external_submission_url: 'https://dorahacks.io/buidl/578',
    } as never,
    installationId,
    { fetchProof: async () => `See the repo: ${project.repo_url}` },
  );
  assert.equal(result.recorded, true);
  assert.doesNotMatch((result as { bonus_note?: string }).bonus_note ?? '', /already holds this repo/);
});

test('v2.6 Ruling 6 (plan), fix round 1: an owner test installation never holds a repo at entry time either', dbTest, async () => {
  const tag = `fw-ruling6-${process.pid}-${Date.now()}`;
  const program = proofProgramFile(tag, { starts_at: '2026-01-01T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' });
  await upsertProgram(program);
  const testInstallationId = await freshInstallation();
  const installationId = await freshInstallation();
  const project = { ...proofProject(79), repo_url: `https://github.com/alice/${tag}` };
  // An otherwise-eligible-looking earlier entry of the same repo, but from an owner test
  // installation: it must never be named as holding the repo (traction.ts eligibleSql agrees).
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, installation_id, bonus_repo_key, coin_address, coin_launched_at, submission_proof_ok_at)
    VALUES (${program.id}, 'Earlier (test)', ${project.repo_url}, ${testInstallationId}, ${`github.com/alice/${tag}`},
      ${`0x${'f'.repeat(36)}${String(process.pid % 10000).padStart(4, '0')}`}, now(), now())`;
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  process.env.EARNKIT_TEST_INSTALLATIONS = String(testInstallationId);
  try {
    const result = await recordSubmission(
      {
        program_id: program.id,
        project,
        submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
        external_submission_url: 'https://dorahacks.io/buidl/580',
      } as never,
      installationId,
      { fetchProof: async () => `See the repo: ${project.repo_url}` },
    );
    assert.equal(result.recorded, true);
    assert.doesNotMatch((result as { bonus_note?: string }).bonus_note ?? '', /already holds this repo/);
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
  }
});

// ---- v2.5 Ruling 13: external entries' contracts and one eligible entry per repo ----------------

test('bonusEligible: a later entry of the same repo is never eligible (Ruling 13b); frozen at the round end (Ruling 16)', () => {
  const ok = { coin_address: '0x' + 'a'.repeat(40), submission_proof_ok_at: new Date('2026-10-10T00:00:00Z') };
  assert.equal(bonusEligible({ ...ok, earlier_same_repo: false }), true);
  assert.equal(bonusEligible({ ...ok, earlier_same_repo: true }), false);
  const ends_at = new Date('2026-10-15T00:00:00Z');
  assert.equal(bonusEligible({ ...ok, ends_at, coin_launched_at: new Date('2026-10-14T00:00:00Z') }), true);
  assert.equal(bonusEligible({ ...ok, ends_at, coin_launched_at: new Date('2026-10-16T00:00:00Z') }), false, 'coin after the end');
  assert.equal(bonusEligible({ ...ok, ends_at, coin_launched_at: null }), false);
  assert.equal(
    bonusEligible({ ...ok, submission_proof_ok_at: new Date('2026-10-15T00:00:00Z'), ends_at, coin_launched_at: new Date('2026-10-01T00:00:00Z') }),
    false,
    'proof at the end',
  );
});

/** The builder: their key deploys the contracts, earnkit.txt names its wallet, and they sign. */
const builder = privateKeyToAccount(('0x' + '42'.repeat(32)) as `0x${string}`);
const BW = builder.address.toLowerCase();
/** Someone else, who can name the builder's public wallet but has only their own key. */
const thief = privateKeyToAccount(('0x' + '43'.repeat(32)) as `0x${string}`);
const REPO = 'https://github.com/alice/tipjar';
const KEY = 'github.com/alice/tipjar';
const byTx = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([c, d]) => [`0x${c.slice(2, 10)}`, d]));
const depsFor = (wallet: string, deployers: Record<string, string>) => ({
  ...entryDeps(byTx(deployers)),
  fetchFile: async () => ({ status: 'ok' as const, text: `payout_wallet: ${wallet}\n` }),
});
const sign = (who: typeof builder, list: string[], wallet = BW, program = 'p') =>
  who.signMessage({ message: entryMessage(program, KEY, wallet, list) });

test('verifiedBonusContracts (Rulings 13a, 16): a contract counts only with its deployer\'s signature', async () => {
  const sig = await sign(builder, [C1, C2]);
  const both = await verifiedBonusContracts('p', REPO, BW, [C1, C2.toUpperCase().replace('0X', '0x')], sig, depsFor(BW, { [C1]: BW, [C2]: BW }));
  assert.deepEqual(both, { contracts: [C1, C2], deployers: [BW], note: null });
  // No signature: nothing counts, even contracts the named wallet deployed; the note gives the message.
  const unsigned = await verifiedBonusContracts('p', REPO, BW, [C1], undefined, depsFor(BW, { [C1]: BW }));
  assert.deepEqual(unsigned.contracts, []);
  assert.match(unsigned.note ?? '', /sign exactly "EarnKit entry: p github\.com\/alice\/tipjar 0x[0-9a-f]{40} 0x1{40}"/);
  // Signed, but C2 was deployed by another wallet: only C1.
  const one = await verifiedBonusContracts('p', REPO, BW, [C1, C2], sig, depsFor(BW, { [C1]: BW, [C2]: '0x' + 'b'.repeat(40) }));
  assert.deepEqual(one.contracts, [C1]);
  assert.match(one.note ?? '', /Contract 0x2{40} was deployed by 0xb{40}/);
  // The agent's wallet deployed it and signed: counts (the payout wallet names earnkit.txt).
  const agent = await verifiedBonusContracts('p', REPO, BW, [C1], await thief.signMessage({ message: entryMessage('p', KEY, BW, [C1]) }), depsFor(BW, { [C1]: thief.address.toLowerCase() }));
  assert.deepEqual(agent.contracts, [C1]);
  // earnkit.txt names another wallet: nothing counts.
  const file = await verifiedBonusContracts('p', REPO, BW, [C1], await sign(builder, [C1]), depsFor('0x' + 'b'.repeat(40), { [C1]: BW }));
  assert.deepEqual(file.contracts, []);
  assert.match(file.note ?? '', /says payout_wallet/);
});

test('verifiedBonusContracts (Ruling 16): naming the victim\'s public wallet without its key claims nothing', async () => {
  // S's repo's earnkit.txt names W_A (public), and S claims C_A, which W_A deployed.
  const deps = depsFor(BW, { [C1]: BW });
  const none = await verifiedBonusContracts('p', REPO, BW, [C1], undefined, deps);
  assert.deepEqual(none.contracts, []);
  const forged = await verifiedBonusContracts('p', REPO, BW, [C1], await thief.signMessage({ message: entryMessage('p', KEY, BW, [C1]) }), deps);
  assert.deepEqual(forged.contracts, []);
  assert.match(forged.note ?? '', /not by the wallet that signed deployer_signature/);
});

test('verifiedBonusContracts: Clanker/Uniswap contracts are never accepted; no wallet or a failed read drops them; never throws', async () => {
  const pool = '0x498581fF718922c3f8e6A244956aF099B2652b2b';
  const r = await verifiedBonusContracts('p', REPO, BW, [pool, C1], await sign(builder, [pool, C1]), depsFor(BW, { [C1]: BW }));
  assert.deepEqual(r.contracts, [C1]);
  assert.match(r.note ?? '', /token launch or Uniswap contracts never count/);
  const noWallet = await verifiedBonusContracts('p', REPO, undefined, [C1], undefined, entryDeps({}));
  assert.deepEqual(noWallet.contracts, []);
  assert.match(noWallet.note ?? '', /pass payout_wallet/);
  const noRepo = await verifiedBonusContracts('p', undefined, BW, [C1], undefined, entryDeps({}));
  assert.match(noRepo.note ?? '', /repo_url/);
  const bad = await verifiedBonusContracts('p', REPO, BW, ['0x123'], undefined, entryDeps({}));
  assert.match(bad.note ?? '', /isn't a Base contract address/);
  const badSig = await verifiedBonusContracts('p', REPO, BW, [C1], '0x1234', depsFor(BW, { [C1]: BW }));
  assert.match(badSig.note ?? '', /not a valid signature/);
  const down = await verifiedBonusContracts('p', REPO, BW, [C1], await sign(builder, [C1]), {
    ...depsFor(BW, {}),
    repoFacts: async () => {
      throw new Error('socket hang up');
    },
  });
  assert.deepEqual(down.contracts, []);
  assert.ok(down.note);
});

test('verifiedBonusContracts (Ruling 15): the signature covers the list as submitted; refused addresses are named', async () => {
  const pool = '0x498581ff718922c3f8e6a244956af099b2652b2b';
  const deps = depsFor(BW, { [C1]: BW });
  const r = await verifiedBonusContracts('p', REPO, BW, [C1, pool], await sign(builder, [C1, pool]), deps);
  assert.deepEqual(r.contracts, [C1]);
  assert.match(r.note ?? '', new RegExp(`${pool}: token launch or Uniswap contracts never count as yours; leave them out of contracts and sign the list without them`));
  // A signature over the list without the pool doesn't match what was submitted.
  const w = await verifiedBonusContracts('p', REPO, BW, [C1, pool], await sign(builder, [C1]), deps);
  assert.deepEqual(w.contracts, []);
});

const randomAddress = () => '0x' + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');

test('record_submission (Rulings 13, 15, 16): signed contracts stored; unsigned dropped; a later same-repo entry is noted', dbTest, async () => {
  const program = proofProgramFile(`t6-contracts-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = { ...proofProject(9), repo_url: REPO };
  // Each later entry is another installation's: the same installation updates its own entry (I1).
  const submit = async (contracts: string[], deployers: Record<string, string>, signed = true, inst = installationId) =>
    recordSubmission(
      {
        program_id: program.id,
        project,
        submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
        external_submission_url: 'https://dorahacks.io/buidl/901',
        contracts,
        payout_wallet: BW,
        ...(signed && { deployer_signature: await sign(builder, contracts, BW, program.id) }),
      } as never,
      inst,
      { ...depsFor(BW, deployers), fetchProof: async () => `See ${REPO}` },
    );
  const first = await submit([C1, C2], { [C1]: BW, [C2]: '0x' + 'b'.repeat(40) });
  assert.equal(first.recorded, true);
  assert.match((first as { bonus_note?: string }).bonus_note ?? '', /Contracts not counted for the builder bonus/);
  const [row] = await sql()<{ contracts: string[] | null; deployers: string[] | null; creator_wallet: string | null; bonus_repo_key: string | null }[]>`
    SELECT contracts, deployers, creator_wallet, bonus_repo_key FROM projects WHERE id = ${first.project_id}`;
  assert.deepEqual(row, { contracts: [C1], deployers: [BW], creator_wallet: BW, bonus_repo_key: KEY });

  const unsigned = await submit([C1], { [C1]: BW }, false, await freshInstallation());
  assert.equal(unsigned.recorded, true, 'never fails the submission');
  const [u] = await sql()<{ contracts: string[] | null }[]>`SELECT contracts FROM projects WHERE id = ${unsigned.project_id}`;
  assert.equal(u.contracts, null);

  // The first entry isn't eligible yet (no coin): it holds neither the repo nor its contract (Ruling 15).
  const second = await submit([C1], { [C1]: BW }, true, await freshInstallation());
  assert.doesNotMatch((second as { bonus_note?: string }).bonus_note ?? '', /already holds this repo|already backs/);
  // Once the first is eligible (coin + proof), a later entry of the repo and contract is noted.
  await sql()`UPDATE projects SET coin_address = ${randomAddress()}, coin_launched_at = now() WHERE id = ${first.project_id}`;
  const third = await submit([C1], { [C1]: BW }, true, await freshInstallation());
  assert.equal(third.recorded, true, 'a later entry of the same repo is still recorded');
  const note = (third as { bonus_note?: string }).bonus_note ?? '';
  assert.match(note, new RegExp(`entry #${first.project_id} already holds this repo`));
  assert.match(note, new RegExp(`${C1} already backs entry #${first.project_id}`));
});

test('repo squat (Ruling 16): S records A\'s repo, then cannot swap in its own repo at launch_token; A is not blocked', dbTest, async () => {
  const program = proofProgramFile(`t6-squat-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const victimRepo = `https://github.com/alice/victim-${process.pid}-${Date.now()}`;
  const record = (installationId: number) =>
    recordSubmission(
      {
        program_id: program.id,
        project: { name: 'X', description: 'x', repo_url: victimRepo, live_url: 'https://x.example' },
        submission_data: { live_deployment_url: 'https://x.example', repo_url: victimRepo, description: 'x', builder_profile: 'https://github.com/alice' },
        external_submission_url: 'https://dorahacks.io/buidl/902',
      } as never,
      installationId,
      { fetchProof: async () => `See ${victimRepo}` },
    );
  const s = await freshInstallation();
  const squat = await record(s);
  const swap = await launchToken(
    LaunchTokenInput.parse({ project_id: squat.project_id, builder_confirmed: true, repo_url: 'https://github.com/squatter/own' }),
    s,
    { available: () => false },
  );
  assert.equal(swap.status, 'failed');
  assert.match(swap.note ?? '', /can't change once recorded; enter the other repo as a new entry/);
  assert.match(swap.agent_note ?? '', /^repo_url: /);
  const [kept] = await sql()<{ repo_url: string; bonus_repo_key: string }[]>`SELECT repo_url, bonus_repo_key FROM projects WHERE id = ${squat.project_id}`;
  assert.equal(kept.repo_url, victimRepo);
  // The live link may still be fixed (launches are off here, so the flow stops before any gate).
  await launchToken(LaunchTokenInput.parse({ project_id: squat.project_id, builder_confirmed: true, live_url: 'https://y.example' }), s, { available: () => false });
  const [live] = await sql()<{ live_url: string; repo_url: string }[]>`SELECT live_url, repo_url FROM projects WHERE id = ${squat.project_id}`;
  assert.equal(live.repo_url, victimRepo);
  assert.match(live.live_url, /^https:\/\/y\.example\/?$/);
  // A, the repo's builder, enters later and gets a coin: eligible; the squatter's row blocks nothing.
  const a = await record(await freshInstallation());
  await sql()`UPDATE projects SET coin_address = ${randomAddress()}, coin_launched_at = now() WHERE id = ${a.project_id}`;
  const ends = new Date(Date.now() + 86_400_000);
  const eligible = await sql()<{ id: number }[]>`
    SELECT p.id FROM projects p WHERE p.program_id = ${program.id} AND ${eligibleSql(ends)}`;
  assert.deepEqual(eligible.map((r) => r.id), [a.project_id]);
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('v2.6 Ruling 10: a non-campaign entry naming a wallet remembers it for the installation; the reply names the round', dbTest, async () => {
  const program = proofProgramFile(`t4-wallet-${process.pid}-${Date.now()}`, { submission_proof: null });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(41);
  const MIXED = '0xAB12000000000000000000000000000000Ef0123';
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
      payout_wallet: MIXED,
    } as never,
    installationId,
  );
  assert.equal(result.recorded, true);
  const [inst] = await sql()<{ payout_wallet: string | null }[]>`SELECT payout_wallet FROM installations WHERE id = ${installationId}`;
  assert.equal(inst.payout_wallet, MIXED.toLowerCase());
  assert.equal(await rememberedWallet(installationId), MIXED.toLowerCase());
  const wallets = await sql()<{ wallet: string }[]>`SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}`;
  assert.deepEqual(wallets.map((w) => w.wallet), [MIXED.toLowerCase()]);
  assert.equal(result.program_title, program.title);
  // The open round of this program now (bonusOn: active, bonus on, not a campaign), for the reply.
  const round = roundFor({ id: program.id, starts_at: program.starts_at ? new Date(program.starts_at) : null, ends_at: program.ends_at ? new Date(program.ends_at) : null }, new Date());
  // Ruling 29: Arc's real deadline (2026-10-15T03:59Z, Oct 14 11:59 PM ET) reads "Oct 14", as in the first message.
  assert.deepEqual(result.bonus_round, round ? { key: round.key, ends_at: round.ends.toISOString(), ends_label: 'Oct 14' } : null);
  // Ruling 22: a wallet given but invalid (one typo in a checksummed address) fails the call:
  // nothing recorded, never silently dropped, and the earlier wallet stays.
  const typo = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a4';
  const before = (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM projects WHERE installation_id = ${installationId}`)[0].n;
  await assert.rejects(
    recordSubmission(
      {
        program_id: program.id,
        project: proofProject(42),
        submission_data: { description: 'x' },
        payout_wallet: typo,
      } as never,
      installationId,
    ),
    (err: unknown) => err instanceof EntryError && err.message === "That wallet address isn't valid. Check it and send it again.",
  );
  const after = (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM projects WHERE installation_id = ${installationId}`)[0].n;
  assert.equal(after, before);
  assert.equal(await rememberedWallet(installationId), MIXED.toLowerCase());
});

test('v2.6 §3: an opted-out program (builder_bonus: false) returns no bonus round', dbTest, async () => {
  const program = proofProgramFile(`t4-off-${process.pid}-${Date.now()}`, { submission_proof: null, builder_bonus: false });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(43);
  const result = await recordSubmission(
    {
      program_id: program.id,
      project,
      submission_data: { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' },
    } as never,
    installationId,
  );
  assert.equal(result.bonus_round, null);
  assert.equal(await rememberedWallet(installationId), null);
});

test('fix round 1 (I1): a late confirmation updates the entry with the coin (same id, one row) and makes it eligible', dbTest, async () => {
  const program = proofProgramFile(`t5f-late-${process.pid}-${Date.now()}`, { submission_proof: null, starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(51);
  const data = { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' };
  let charged = 0;
  const charge = async () => { charged++; };
  const first = await recordSubmission({ program_id: program.id, project, submission_data: data } as never, installationId, { charge });
  assert.match((first as { bonus_note?: string }).bonus_note ?? '', /builder_submitted: true/);
  assert.deepEqual((first as { bonus_join?: unknown }).bonus_join, { kind: 'confirm', site: new URL(program.submission_url).hostname.replace(/^www\./, '') });
  // The first call launched the coin on this row.
  await sql()`UPDATE projects SET coin_address = ${randomAddress()}, coin_launched_at = now(), token_url = 'https://tokens.fun/coin/0x1' WHERE id = ${first.project_id}`;
  const ends = new Date('2099-01-01T00:00:00Z');
  const eligible = async () =>
    (await sql()<{ id: number }[]>`SELECT p.id FROM projects p WHERE p.program_id = ${program.id} AND ${eligibleSql(ends)}`).map((r) => r.id);
  assert.deepEqual(await eligible(), []);
  // The builder says yes: the same row, not a second one, and not charged as a new entry.
  const late = await recordSubmission(
    { program_id: program.id, project: { ...project, repo_url: project.repo_url.toUpperCase().replace('HTTPS://GITHUB.COM', 'https://github.com') }, submission_data: data, builder_submitted: true } as never,
    installationId,
    { charge },
  );
  assert.equal(late.project_id, first.project_id);
  assert.equal((late as { updated?: boolean }).updated, true);
  assert.equal((late as { coin_url?: string | null }).coin_url, 'https://tokens.fun/coin/0x1');
  assert.equal((late as { bonus_join?: unknown }).bonus_join, null);
  assert.equal(charged, 1);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM projects WHERE program_id = ${program.id}`;
  assert.equal(n, 1);
  const [row] = await sql()<{ submission_basis: string | null; submission_confirmed_at: Date | null }[]>`
    SELECT submission_basis, submission_confirmed_at FROM projects WHERE id = ${first.project_id}`;
  assert.equal(row.submission_basis, 'confirmed');
  assert.ok(row.submission_confirmed_at instanceof Date);
  assert.deepEqual(await eligible(), [first.project_id]);
  // Calling again without the flag keeps the confirmation (never silently dropped).
  await recordSubmission({ program_id: program.id, project, submission_data: data } as never, installationId, { charge });
  assert.deepEqual(await eligible(), [first.project_id]);
  // Another installation entering the same repo never touches this row (one-per-repo stays intact).
  const other = await recordSubmission({ program_id: program.id, project, submission_data: data, builder_submitted: true } as never, await freshInstallation(), { charge });
  assert.notEqual(other.project_id, first.project_id);
  assert.deepEqual(await eligible(), [first.project_id], 'the later same-repo entry is never eligible');
});

test('fix round 2 (N1): a re-record reports a coin only for an EarnKit coin, never a token_url the builder typed', dbTest, async () => {
  const program = proofProgramFile(`t5f2-n1-${process.pid}-${Date.now()}`, { submission_proof: null, starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = { ...proofProject(61), token_url: 'https://example.com/their-own-token' };
  const data = { description: 'x' };
  const first = await recordSubmission({ program_id: program.id, project, submission_data: data } as never, installationId);
  const late = await recordSubmission({ program_id: program.id, project, submission_data: data, builder_submitted: true } as never, installationId);
  assert.equal(late.project_id, first.project_id);
  assert.equal((late as { coin_url?: string | null }).coin_url, null, 'their own token is not an EarnKit coin');
  // An EarnKit coin on the row is reported.
  await sql()`UPDATE projects SET token_url = 'https://tokens.fun/coin/0x9', token_status = 'launched', coin_address = ${randomAddress()} WHERE id = ${first.project_id}`;
  const again = await recordSubmission({ program_id: program.id, project, submission_data: data } as never, installationId);
  assert.equal((again as { coin_url?: string | null }).coin_url, 'https://tokens.fun/coin/0x9');
  // A launch in flight is reported as pending.
  await sql()`UPDATE projects SET token_url = 'pending', token_status = 'pending', coin_address = NULL WHERE id = ${first.project_id}`;
  const pending = await recordSubmission({ program_id: program.id, project, submission_data: data } as never, installationId);
  assert.equal((pending as { coin_url?: string | null }).coin_url, 'pending');
});
