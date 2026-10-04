import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersOf,
  campaignEntryProblems,
  submissionDataProblem,
  entryRules,
  missingAnswersProblem,
  selfEntryProblem,
} from './projects';
import { sponsorProgramFile } from './sponsor-rules';
import type { SubmissionRequirement } from './program-file';
import { privateKeyToAccount } from 'viem/accounts';
import { EntryError } from './campaigns';
import { setSanctionsOracle } from './sanctions';
import { entryMessage } from './entry-proof';
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
          `deployer_signature: sign exactly "EarnKit entry: earnkit-campaign-1-base github.com/alice/tipjar ${PAY} ${C1},${C2}" with the wallet that deployed the contracts.`,
        ),
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
