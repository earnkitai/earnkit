import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersOf,
  bonusEligible,
  completeAt,
  campaignEntryProblems,
  recordSubmission,
  submissionDataProblem,
  OTHER_VALUE_MAX,
  entryRules,
  missingAnswersProblem,
  selfEntryProblem,
} from './projects';
import { LaunchTokenInput, completeAtWindow, launchToken } from './token-launch';
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
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { rememberedWallet } from './installations';
import type { ProgramRow } from './programs';
import { committedProgram } from './fixtures/program-file';
import { errorLines, eventsByKey, eventsOfInstallation, withEventLog, withFailingEventLog } from './fixtures/events';

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
      'Call prepare to see what each needs, then confirm again.',
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
  const f = committedProgram('earnkit-campaign-1-base');
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
  project: { name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar.xyz' },
  submission_data: {
    project_name: 'Tip Jar', description: 'Tips for creators', repo_url: 'https://github.com/alice/tipjar',
    live_url: 'https://tipjar.xyz', contracts: `${C1},${C2}`, payout_wallet: PAY, ...data,
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
        assert.match(err.message, /^Fix these, then call confirm again:\n- /);
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
    i.project = { name: 'Tip Jar', live_url: 'https://tipjar.xyz' } as never;
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

/** v2.8 Ruling 2 (plan): a complete entry, confirmed "go" (or never asked, an older agent). */
const COMPLETE_GO = { complete_at: new Date('2026-10-09T00:00:00Z'), confirm_choice: null };

test('bonusEligible: a coin and a checked-out proof, both required', () => {
  assert.equal(bonusEligible({ ...COMPLETE_GO, coin_address: null, submission_proof_ok_at: null }), false);
  assert.equal(bonusEligible({ ...COMPLETE_GO, coin_address: '0x' + 'a'.repeat(40), submission_proof_ok_at: null }), false);
  assert.equal(bonusEligible({ ...COMPLETE_GO, coin_address: null, submission_proof_ok_at: new Date() }), false);
  assert.equal(bonusEligible({ ...COMPLETE_GO, coin_address: '0x' + 'a'.repeat(40), submission_proof_ok_at: new Date() }), true);
});

test('v2.8 Rulings 2-3 (plan): bonusEligible needs a launched token, a complete entry and never a skip', () => {
  const ends_at = new Date('2026-10-15T00:00:00Z');
  const all = {
    coin_address: '0x' + 'a'.repeat(40),
    coin_launched_at: new Date('2026-10-08T00:00:00Z'),
    submission_proof_ok_at: new Date('2026-10-10T00:00:00Z'),
    complete_at: new Date('2026-10-09T00:00:00Z'),
    confirm_choice: 'go' as const,
    ends_at,
  };
  assert.equal(bonusEligible(all), true);
  assert.equal(bonusEligible({ ...all, confirm_choice: null }), true, 'an older agent never confirmed: still eligible');
  assert.equal(bonusEligible({ ...all, complete_at: null }), false, 'entry incomplete');
  assert.equal(bonusEligible({ ...all, complete_at: '2026-10-16T00:00:00Z' }), false, 'complete only after the end');
  assert.equal(bonusEligible({ ...all, complete_at: ends_at }), false, 'complete at the end');
  assert.equal(bonusEligible({ ...all, confirm_choice: 'skip' }), false, 'skipped is final');
  assert.equal(bonusEligible({ ...all, coin_address: null }), false, 'no launched token');
  // Without a round, the same three conditions.
  const noRound = { ...all, ends_at: undefined };
  assert.equal(bonusEligible(noRound), true);
  assert.equal(bonusEligible({ ...noRound, complete_at: null }), false);
  assert.equal(bonusEligible({ ...noRound, confirm_choice: 'skip' }), false);
  assert.equal(bonusEligible({ ...noRound, coin_address: null }), false);
});

test('v2.8 Ruling 2 (plan): completeAt is set once, the first time the entry is ready, never cleared', () => {
  const reqs: SubmissionRequirement[] = [
    { key: 'live_deployment_url', label: 'Live', type: 'url', required: true, project_field: 'live_url', from: 'project' },
    { key: 'description', label: 'Description', type: 'text', required: true, from: 'project' },
    { key: 'profile', label: 'Profile', type: 'url', required: false, from: 'builder' },
  ];
  const now = new Date('2026-10-09T12:00:00Z');
  const ready = { project: { live_url: 'https://kit.xyz' }, answers: { description: 'A kit.' } };
  const notReady = { project: { live_url: 'https://kit.xyz' }, answers: {} };
  assert.equal(completeAt(reqs, ready, null, now), now);
  assert.equal(completeAt(reqs, notReady, null, now), null);
  const previous = new Date('2026-10-01T00:00:00Z');
  assert.equal(completeAt(reqs, notReady, previous, now), previous, 'never cleared');
  assert.equal(completeAt(reqs, ready, previous, now), previous, 'never moved');
  // An invalid value is not complete; no requirements is complete.
  assert.equal(completeAt(reqs, { project: { live_url: 'http://kit' }, answers: { description: 'A kit.' } }, null, now), null);
  assert.equal(completeAt([], {}, null, now), now);
});

/** arc-microgrants.json (real submission_proof: dorahacks.io, /buidl/<id>) under a fresh id. */
function proofProgramFile(id: string, overrides: Record<string, unknown> = {}) {
  const f = committedProgram('arc-microgrants');
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
  live_url: `https://proof-${n}.xyz`,
});

// ---- v2.5 Ruling 13: external entries' contracts and one eligible entry per repo ----------------

test('bonusEligible: a later entry of the same repo is never eligible (Ruling 13b); frozen at the round end (Ruling 16)', () => {
  const ok = { ...COMPLETE_GO, coin_address: '0x' + 'a'.repeat(40), submission_proof_ok_at: new Date('2026-10-10T00:00:00Z') };
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

const randomAddress = () => '0x' + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');

test('repo squat (Ruling 16): S records A\'s repo, then cannot swap in its own repo at launch_token; A is not blocked', dbTest, async () => {
  const program = proofProgramFile(`t6-squat-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const victimRepo = `https://github.com/alice/victim-${process.pid}-${Date.now()}`;
  const record = (installationId: number) =>
    recordSubmission(
      {
        program_id: program.id,
        project: { name: 'X', description: 'x', repo_url: victimRepo, live_url: 'https://x.xyz' },
        submission_data: { live_deployment_url: 'https://x.xyz', repo_url: victimRepo, description: 'x', builder_profile: 'https://github.com/alice' },
        external_submission_url: 'https://dorahacks.io/buidl/902',
      } as never,
      installationId,
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
  await launchToken(LaunchTokenInput.parse({ project_id: squat.project_id, builder_confirmed: true, live_url: 'https://y.xyz' }), s, { available: () => false });
  const [live] = await sql()<{ live_url: string; repo_url: string }[]>`SELECT live_url, repo_url FROM projects WHERE id = ${squat.project_id}`;
  assert.equal(live.repo_url, victimRepo);
  assert.match(live.live_url, /^https:\/\/y\.xyz\/?$/);
  // A, the repo's builder, enters later and gets a coin: eligible; the squatter's row blocks nothing.
  const a = await record(await freshInstallation());
  await sql()`UPDATE projects SET coin_address = ${randomAddress()}, coin_launched_at = now() WHERE id = ${a.project_id}`;
  const ends = new Date(Date.now() + 86_400_000);
  const eligible = await sql()<{ id: number }[]>`
    SELECT p.id FROM projects p WHERE p.program_id = ${program.id} AND ${eligibleSql(ends, null)}`;
  assert.deepEqual(eligible.map((r) => r.id), [a.project_id]);
});

test('v2.8 Ruling 2 (plan): record_submission sets complete_at once the entry is ready, and never clears it', dbTest, async () => {
  const program = proofProgramFile(`t7-complete-${process.pid}-${Date.now()}`, { submission_proof: null });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(71);
  const full = { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' };
  const completeOf = async (id: number) =>
    (await sql()<{ complete_at: Date | null }[]>`SELECT complete_at FROM projects WHERE id = ${id}`)[0].complete_at;
  // Missing the required builder profile: recorded, not complete.
  const partial = { live_deployment_url: full.live_deployment_url, repo_url: full.repo_url, description: full.description };
  const first = await recordSubmission({ program_id: program.id, project, submission_data: partial } as never, installationId);
  assert.equal(await completeOf(first.project_id), null);
  // The same entry again with every answer: the same row, now complete.
  const second = await recordSubmission({ program_id: program.id, project, submission_data: full } as never, installationId);
  assert.equal(second.project_id, first.project_id);
  const at = await completeOf(first.project_id);
  assert.ok(at instanceof Date);
  // Recorded again with an answer missing: complete_at is kept, never cleared or moved.
  await recordSubmission({ program_id: program.id, project, submission_data: partial } as never, installationId);
  assert.equal((await completeOf(first.project_id))?.getTime(), at.getTime());
  // A new entry recorded complete in one call is complete from the start.
  const other = await recordSubmission({ program_id: program.id, project: proofProject(72), submission_data: { ...full, repo_url: proofProject(72).repo_url, live_deployment_url: proofProject(72).live_url } } as never, installationId);
  assert.ok((await completeOf(other.project_id)) instanceof Date);
});

test('v2.8 Ruling C7: completeAtWindow marks deploy-window launches complete only when the stored entry passes; dry run by default; idempotent', dbTest, async () => {
  const program = proofProgramFile(`t7-window-${process.pid}-${Date.now()}`, { submission_proof: null });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  // A one-hour window in 2001 unique to this run, so other rows never fall in it.
  const since = new Date(Date.UTC(2001, 0, 1) + (Date.now() % 1_000_000) * 3_600_000);
  const until = new Date(since.getTime() + 3_600_000);
  const inWindow = new Date(since.getTime() + 600_000);
  const full = { description: 'A kit.', builder_profile: 'https://github.com/alice' };
  const add = async (
    n: number,
    o: { launched: Date; data: Record<string, unknown>; live?: string | null; choice?: 'go' | 'skip'; complete_at?: Date; unverified?: boolean },
  ) => {
    // v2.9 A5 (Pre-flight P5): a live link counts once a check found it loading (live_verified_at).
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, coin_address, coin_launched_at, confirm_choice, complete_at, live_verified_at)
      VALUES (${program.id}, ${`W${n}`}, ${`https://github.com/alice/w${n}`}, ${o.live === undefined ? `https://w${n}.xyz` : o.live},
        ${installationId}, ${randomAddress()}, ${o.launched}, ${o.choice ?? null}, ${o.complete_at ?? null}, ${o.unverified ? null : o.launched})
      RETURNING id`;
    await sql()`INSERT INTO submissions (project_id, submission_data) VALUES (${id}, ${sql().json(o.data as never)})`;
    return id;
  };
  const done = await add(1, { launched: inWindow, data: full });
  const incomplete = await add(2, { launched: inWindow, data: full, live: null });
  const confirmed = await add(3, { launched: inWindow, data: full, choice: 'go' });
  const outside = await add(4, { launched: new Date(since.getTime() - 60_000), data: full });
  const earlier = new Date(since.getTime() + 60_000);
  const already = await add(5, { launched: inWindow, data: full, complete_at: earlier });
  const unverified = await add(6, { launched: inWindow, data: full, unverified: true });
  const completeOf = async (id: number) =>
    (await sql()<{ complete_at: Date | null }[]>`SELECT complete_at FROM projects WHERE id = ${id}`)[0].complete_at;

  const dry = await completeAtWindow({ since, until, apply: false });
  assert.deepEqual(dry, { launched_without_complete: 3, complete: 1, updated: 0 });
  assert.equal(await completeOf(done), null, 'a dry run writes nothing');
  const applied = await completeAtWindow({ since, until, apply: true });
  assert.deepEqual(applied, { launched_without_complete: 3, complete: 1, updated: 1 });
  assert.equal(await completeOf(unverified), null, 'v2.9 A5: an unverified live link is missing');
  assert.equal((await completeOf(done))?.getTime(), inWindow.getTime(), 'complete_at = coin_launched_at');
  assert.equal(await completeOf(incomplete), null, 'a stored entry missing a required item stays incomplete');
  assert.equal(await completeOf(confirmed), null, 'confirmed through v2.8: not a v2.7 launch, untouched');
  assert.equal(await completeOf(outside), null, 'outside the window: untouched');
  assert.equal((await completeOf(already))?.getTime(), earlier.getTime(), 'a set complete_at never moves');
  // Run again: nothing left to do.
  assert.deepEqual(await completeAtWindow({ since, until, apply: true }), { launched_without_complete: 2, complete: 0, updated: 0 });
});

after(async () => {
  // Task 17: this file's programs never outlive the run.
  if (process.env.DATABASE_URL) await dropRunPrograms();
  if (process.env.DATABASE_URL) await sql().end();
});

test('v2.6 Ruling 10: a non-campaign entry naming a wallet remembers it for the installation', dbTest, async () => {
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
  assert.equal('bonus_round' in result, false, 'v2.14: no builder bonus round');
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

test('fix round 1 (I1): a late confirmation updates the entry with the coin (same id, one row) and makes it eligible', dbTest, async () => {
  const program = proofProgramFile(`t5f-late-${process.pid}-${Date.now()}`, { submission_proof: null, starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const project = proofProject(51);
  const data = { live_deployment_url: project.live_url, repo_url: project.repo_url, description: project.description, builder_profile: 'https://github.com/alice' };
  let charged = 0;
  const charge = async () => { charged++; };
  const first = await recordSubmission({ program_id: program.id, project, submission_data: data } as never, installationId, { charge });
  assert.match((first as { bonus_note?: string }).bonus_note ?? '', /Call tell with submitted once the builder confirms/);
  assert.deepEqual((first as { bonus_join?: unknown }).bonus_join, { kind: 'confirm', site: new URL(program.submission_url).hostname.replace(/^www\./, '') });
  // The first call launched the coin on this row.
  await sql()`UPDATE projects SET coin_address = ${randomAddress()}, coin_launched_at = now(), token_url = 'https://tokens.fun/coin/0x1' WHERE id = ${first.project_id}`;
  const ends = new Date('2099-01-01T00:00:00Z');
  const eligible = async () =>
    (await sql()<{ id: number }[]>`SELECT p.id FROM projects p WHERE p.program_id = ${program.id} AND ${eligibleSql(ends, null)}`).map((r) => r.id);
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
  const project = { ...proofProject(61), token_url: 'https://tipjar.xyz/their-own-token' };
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

test('4.14 (R10, Pre-flight P4) startEntry marks repo_private only when the repo was read through the App; no facts row means public', dbTest, async () => {
  const { startEntry } = await import('./projects');
  const { getProgramRow } = await import('./programs');
  const program = proofProgramFile(`t414-${process.pid}-${Date.now()}`);
  await upsertProgram(program);
  const row = (await getProgramRow(program.id))!;
  const installationId = await freshInstallation();
  const tag = `${process.pid}-${Date.now()}`;
  const enter = (repo: string | undefined, name: string) =>
    startEntry({ program: row, installationId, project: { name, description: 'A tiny app', ...(repo && { repo_url: repo }) }, answers: {}, choice: 'go', now: new Date() });
  const privateOf = async (id: number) => (await sql()<{ repo_private: boolean }[]>`SELECT repo_private FROM projects WHERE id = ${id}`)[0].repo_private;
  const fact = (full: string, viaApp: boolean) => sql()`
    INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since, via_app)
    VALUES (${full.toLowerCase()}, now(), '{}', '{}', ${viaApp})`;
  try {
    // No cached facts row: public (P4 replaces "fail closed on no row", which hid nearly every public repo).
    assert.equal(await privateOf((await enter(`https://github.com/alice/none-${tag}`, 'None')).id), false);
    // A row read with EarnKit's own token: public.
    await fact(`alice/public-${tag}`, false);
    assert.equal(await privateOf((await enter(`https://github.com/alice/public-${tag}`, 'Public')).id), false);
    // A row read through the App: private, matched case-insensitively.
    await fact(`alice/secret-${tag}`, true);
    const secret = await enter(`https://github.com/Alice/Secret-${tag}`, 'Secret');
    assert.equal(await privateOf(secret.id), true);
    // Once private, the same entry stays private (fail closed) even after the facts row is gone.
    await sql()`DELETE FROM github_repo_facts WHERE full_name = ${`alice/secret-${tag}`}`;
    const again = await enter(`https://github.com/Alice/Secret-${tag}`, 'Secret');
    assert.equal(again.id, secret.id);
    assert.equal(await privateOf(again.id), true);
    // No repo link: nothing to hide.
    assert.equal(await privateOf((await enter(undefined, 'No repo')).id), false);
  } finally {
    await sql()`DELETE FROM github_repo_facts WHERE full_name LIKE ${`alice/%-${tag}`}`;
  }
});

// ---- v2.11 T3: the entered event

test('3.4 the confirmation step writes entered once for a new entry; a second confirm on the same entry writes none', dbTest, () =>
  withEventLog(async () => {
    const { startEntry } = await import('./projects');
    const { getProgramRow } = await import('./programs');
    const program = proofProgramFile(`t3-4-${process.pid}-${Date.now()}`);
    await upsertProgram(program);
    const row = (await getProgramRow(program.id))!;
    const installationId = await freshInstallation();
    const tag = `${process.pid}${Date.now()}`;
    const confirm = () =>
      startEntry({ program: row, installationId, project: { name: 'Tip Jar', repo_url: `https://github.com/Alice${tag}/TipJar` }, answers: {}, choice: 'go', now: new Date() });
    const first = await confirm();
    const second = await confirm();
    assert.equal(second.id, first.id);
    const events = await eventsOfInstallation(installationId);
    assert.equal(events.length, 1);
    const e = events[0];
    assert.equal(e.type, 'entered');
    assert.equal(e.dedupe_key, `entered:${first.id}`);
    assert.equal(e.project_id, first.id);
    assert.equal(e.program_id, program.id);
    assert.equal(e.repo_key, `alice${tag}/tipjar`);
    assert.match(e.proof_url ?? '', new RegExp(`/p/${first.id}$`));
    assert.equal(e.github_login, null, 'no sign-in and no proof line: no login');
    assert.equal(e.login_basis, null);
    assert.equal(e.wallet, null);
  }),
);

test('3.4 record_submission writes entered (with the wallet the builder gave) and submitted for a new entry; a re-record writes neither again', dbTest, () =>
  withEventLog(async () => {
    const program = proofProgramFile(`t3-4r-${process.pid}-${Date.now()}`, { submission_proof: null });
    await upsertProgram(program);
    const installationId = await freshInstallation();
    const project = proofProject(343);
    const WALLET = '0xAB12000000000000000000000000000000Ef0123';
    const record = () =>
      recordSubmission(
        { program_id: program.id, project, submission_data: { repo_url: project.repo_url, description: project.description }, payout_wallet: WALLET } as never,
        installationId,
      );
    const first = await record();
    const again = await record();
    assert.equal(again.project_id, first.project_id);
    const events = await eventsByKey(`entered:${first.project_id}`);
    assert.equal(events.length, 1);
    assert.equal(events[0].wallet, WALLET.toLowerCase());
    assert.equal(events[0].repo_key, 'alice/proof-343');
    const [submitted] = await eventsByKey(`submitted:${first.project_id}`);
    assert.equal(submitted.type, 'submitted', 'record_submission recorded it: submitted (Ruling C10), as the backfill reads it');
    assert.equal(submitted.proof_url, null);
    assert.deepEqual(submitted.detail, { basis: 'recorded' });
    assert.deepEqual((await eventsOfInstallation(installationId)).map((e) => e.type), ['entered', 'submitted']);
  }),
);

test('3.6 a failing event write leaves the entry reply identical to the success path', dbTest, async () => {
  const program = proofProgramFile(`t3-6e-${process.pid}-${Date.now()}`, { submission_proof: null });
  await upsertProgram(program);
  const project = proofProject(366);
  const record = (installationId: number) =>
    recordSubmission({ program_id: program.id, project, submission_data: { repo_url: project.repo_url, description: project.description } } as never, installationId);
  const okInstallation = await freshInstallation();
  const ok = await withEventLog(() => record(okInstallation));
  const failInstallation = await freshInstallation();
  let failed: Awaited<ReturnType<typeof record>> | undefined;
  const lines = await errorLines(() => withFailingEventLog(async () => (failed = await record(failInstallation))));
  const same = (r: Record<string, unknown>) => ({ ...r, project_id: 0, submitted_at: '' });
  assert.deepEqual(same(failed as never), same(ok as never));
  assert.deepEqual(lines, ['[events] entered PostgresError', '[events] submitted PostgresError']);
  assert.equal((await eventsOfInstallation(okInstallation)).length, 2);
  assert.equal((await eventsOfInstallation(failInstallation)).length, 0);
});
