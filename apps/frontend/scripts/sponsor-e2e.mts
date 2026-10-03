import './env.mts';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  createWalletClient,
  erc20Abi,
  http,
  parseUnits,
  publicActions,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { DraftRequest } from '../lib/earnkit/sponsor-rules';

/**
 * Full sponsor flow on a local anvil with the contracts deployed:
 *   ESCROW_CHAIN=local ESCROW_RPC_URL=http://127.0.0.1:8547 ESCROW_FACTORY_ADDRESS=… ESCROW_LOCAL_TOKEN=…
 *   DATABASE_URL=… pnpm sponsor:e2e
 * Deployed with OPERATOR = anvil #2, TREASURY = anvil #3, PAUSER (each clone's guardian) = anvil #0.
 * Anvil time is warped past deadlines; nothing touches a real network.
 *
 * v2.2 (wallet binding): every draft is bound to its sponsor wallet; EarnKit finds the funding and
 * the award by reading the chain (status, `pnpm campaign sync`), never from a reported tx hash.
 * Beyond draft -> fund -> entries -> award, this script exercises:
 *   1. a front-run: another wallet funds the same ref first; EarnKit ignores it, the bound wallet's
 *      deposit publishes, and `campaign refund --escrow` returns the stray deposit (no tx needed)
 *   2. a deposit from the bound wallet with the wrong amount: refused and named, never published
 *   3. concurrent chain checks for one ref publish once
 *   4. an expired draft rescued by its deposit (status, and `campaign sync <ref>`); `sync` with no
 *      ref sweeps every draft, expired and live campaign
 *   5. an off-plan award (the sponsor calls the escrow directly) with a non-entry wallet
 *   6. award plans refuse a payout wallet that is an EarnKit escrow (sponsor and fallback CLI)
 *   7. the operator fallback: propose too early (refused), propose, re-propose (restarts the
 *      delay), execute too early (refused), execute after the 72 h delay; and on another campaign
 *      propose -> guardian veto -> re-propose refused (the veto is sticky) -> the sponsor reclaims
 *      after 60 days and status records the refund
 *   8. the same repo entered twice is refused; lazily expiring drafts; entry statuses (board,
 *      entry page, "Your campaign entries"); sponsor replies with no tx hashes; CLI refusals
 *   9. v2.2 §6: create with five answers (defaults listed), awards and a fallback by ranking
 */
function guardFail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Safety guard, checked before any app module (lib/earnkit/db, lib/earnkit/sponsor, ...) is
// imported: this script inserts rows and sends real transactions, so it must never run against
// anything but a local anvil and a local Postgres, however it's invoked or whatever a
// developer's apps/frontend/.env.local happens to point at.
if (process.env.ESCROW_CHAIN !== 'local') {
  guardFail(
    `ESCROW_CHAIN must be "local" to run this script (got ${JSON.stringify(process.env.ESCROW_CHAIN ?? null)}).`,
  );
}
// The 50 USDC minimum pool is lowered on the local chain only, for this script's small pools.
process.env.SPONSOR_MIN_POOL ??= '1';
const guardDbUrl = process.env.DATABASE_URL ?? '';
let guardDbHost = '';
try {
  guardDbHost = new URL(guardDbUrl).hostname;
} catch {
  guardFail(
    `DATABASE_URL is missing or not a valid URL (got ${JSON.stringify(guardDbUrl)}).`,
  );
}
if (guardDbHost !== 'localhost' && guardDbHost !== '127.0.0.1') {
  guardFail(
    `DATABASE_URL must point at localhost or 127.0.0.1 (got host ${JSON.stringify(guardDbHost)}).`,
  );
}
const guardRpcUrl = process.env.ESCROW_RPC_URL;
if (!guardRpcUrl) guardFail('ESCROW_RPC_URL is not set.');
const guardChainId: number = await fetch(guardRpcUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_chainId',
    params: [],
  }),
})
  .then((r) => r.json())
  .then((j) => Number(j.result))
  .catch((err) =>
    guardFail(`Could not reach ESCROW_RPC_URL (${guardRpcUrl}): ${err}`),
  );
if (guardChainId !== 31337) {
  guardFail(
    `ESCROW_RPC_URL must be a local anvil (chain id 31337); it reported ${guardChainId}.`,
  );
}

const RPC = guardRpcUrl;
const sponsorKey =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // anvil #1
const operatorKey =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'; // anvil #2 (OPERATOR at deploy)
const guardianKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil #0 (PAUSER at deploy)
const treasury = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // anvil #3 (TREASURY at deploy)
const walletOf = (key: `0x${string}`) =>
  createWalletClient({
    account: privateKeyToAccount(key),
    chain: foundry,
    transport: http(RPC),
  }).extend(publicActions);
const wallet = walletOf(sponsorKey);
const SPONSOR = wallet.account.address.toLowerCase();
// anvil #4: someone else, who tries to fund a sponsor's draft first.
const attacker = walletOf(
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
);
const rpc = (method: string, params: unknown[]) =>
  fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
const warpDays = async (days: number) => {
  await rpc('evm_increaseTime', [Math.round(days * 86_400)]);
  await rpc('evm_mine', []);
};

// The earnkit.txt override below is honoured only when NODE_ENV is development or test.
(process.env as Record<string, string>).NODE_ENV ??= 'test';
// GitHub's repo facts (fork, created_at, pushed_at), stood in for: no network.
const forks = new Set<string>();
const github = {
  repoFacts: async (owner: string, repo: string) => ({
    fork: forks.has(`${owner}/${repo}`.toLowerCase()),
    created_at: '2026-09-01T00:00:00Z',
    pushed_at: '2026-10-01T00:00:00Z',
  }),
};

// Builders prove they own the repo they enter with earnkit.txt at its root (v2.2 §1). The real
// fetch goes to raw.githubusercontent.com; here a tiny local static server stands in for it
// (EARNKIT_OWNERSHIP_BASE_URL, refused in production), serving /<owner>/<repo>/HEAD/earnkit.txt.
const ownershipFiles = new Map<string, string>();
const ownershipServer = createServer((req, res) => {
  const body = ownershipFiles.get((req.url ?? '').toLowerCase());
  res.writeHead(body === undefined ? 404 : 200, {
    'content-type': 'text/plain',
  });
  res.end(body ?? 'not found');
});
await new Promise<void>((r) => ownershipServer.listen(0, '127.0.0.1', r));
ownershipServer.unref();
process.env.EARNKIT_OWNERSHIP_BASE_URL = `http://127.0.0.1:${(ownershipServer.address() as AddressInfo).port}`;
/** Publishes earnkit.txt for a github.com/<owner>/<repo> link, naming `payout`. */
const ownRepo = (repoUrl: string, payout: string, contracts: string[] = []) => {
  const [, owner, repo] = new URL(repoUrl).pathname.split('/');
  ownershipFiles.set(
    `/${owner}/${repo}/head/earnkit.txt`.toLowerCase(),
    `payout_wallet: ${payout}\n${contracts.length ? `contracts: ${contracts.join(', ')}\n` : ''}`,
  );
};

const { sql } = await import('../lib/earnkit/db');
const {
  createSponsorDraft,
  checkChain,
  sponsorStatus,
  prepareAward,
  loadCampaign,
  DEADLINE_PASSED,
} = await import('../lib/earnkit/sponsor');
const { tools } = await import('../lib/earnkit/tools');
const { recordSubmission } = await import('../lib/earnkit/projects');
const { presentYourEntries, entryStatus } = await import(
  '../lib/earnkit/campaigns'
);
const { getCampaignBoard, getProjectPage, yourCampaignEntries, entryNames } =
  await import('../lib/earnkit/leaderboard');
const { campaignAbi, campaignsAbi } = await import('../lib/earnkit/escrow-abi');
const db = sql();

const check = (ok: unknown, what: string) => {
  if (!ok) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
  console.log(`ok: ${what}`);
};

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// The campaign.mts admin commands, run as a real subprocess (same as `pnpm campaign ...`), so
// this e2e also proves out the operator CLI, not just the library functions it calls into.
const tsxBin = fileURLToPath(
  new URL('../../../node_modules/.bin/tsx', import.meta.url),
);
const campaignScript = fileURLToPath(new URL('campaign.mts', import.meta.url));
const cliEnv = (env: Record<string, string> = {}) => ({
  ...process.env,
  OPERATOR_PRIVATE_KEY: operatorKey,
  ...env,
});
/** Runs the CLI expecting it to fail; returns its stderr (one line, no stack trace). */
function runCampaignCliFails(env: Record<string, string>, ...args: string[]) {
  try {
    execFileSync(tsxBin, [campaignScript, ...args], {
      env: cliEnv(env),
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    const e = err as { status: number; stderr: string };
    return { status: e.status, stderr: e.stderr.trim() };
  }
  fail(`campaign ${args.join(' ')} was expected to fail but succeeded`);
}

function runCampaignCliAs(env: Record<string, string>, ...args: string[]) {
  try {
    return execFileSync(tsxBin, [campaignScript, ...args], {
      env: cliEnv(env),
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    fail(
      `campaign ${args.join(' ')} failed: ${e.stderr || e.stdout || e.message}`,
    );
  }
}
const runCampaignCli = (...args: string[]) => runCampaignCliAs({}, ...args);

const [{ id: inst }] = await db<{ id: number }[]>`
  INSERT INTO installations (token_hash) VALUES (${'e2e-' + Date.now()}) RETURNING id`;
// Builders enter from their own installation: a sponsor's installation can't enter its campaigns.
const [{ id: builder }] = await db<{ id: number }[]>`
  INSERT INTO installations (token_hash) VALUES (${'e2e-builder-' + Date.now()}) RETURNING id`;
const token = process.env.ESCROW_LOCAL_TOKEN as `0x${string}`;
const mintAbi = [
  {
    type: 'function',
    name: 'mint',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
const mint = async (to: `0x${string}`, amount: string) =>
  wallet.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: token,
      abi: mintAbi,
      functionName: 'mint',
      args: [to, parseUnits(amount, 6)],
    }),
  });
await mint(wallet.account.address, '1000');
await mint(attacker.account.address, '10');
const balanceOf = (a: string) =>
  wallet.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [a as `0x${string}`],
  });

const DAY = 86_400_000;
function mkDraft(
  title: string,
  amount: string,
  endsInDays: number,
  winners = 1,
): DraftRequest {
  return {
    // Checksummed, as a sponsor's agent would usually pass it; stored lowercase.
    sponsor_wallet: wallet.account.address,
    sponsor_name: 'E2E Co',
    title,
    theme: 'Build anything on Base that works end to end.',
    criteria: 'The one that works best.',
    chains: ['base'],
    token: 'USDC',
    amount,
    winners,
    existing_work: 'allowed',
    ends_at: new Date(Date.now() + endsInDays * DAY).toISOString(),
  };
}

type Txs = { to: `0x${string}`; data: `0x${string}` }[];
/** Sends a draft's approve + createCampaign from `from` (the bound sponsor by default). */
async function fund(txs: Txs, from = wallet) {
  for (const tx of txs) {
    const hash = await from.sendTransaction({ to: tx.to, data: tx.data });
    await from.waitForTransactionReceipt({ hash });
  }
}

/** Creates a draft and deposits from the bound wallet. Nothing is reported to EarnKit. */
async function createAndFund(input: DraftRequest) {
  const draft = await createSponsorDraft(input, inst);
  await fund(draft.transactions);
  return { ref: draft.ref, draft };
}

type Reply = {
  state: string;
  show_to_sponsor: string;
  next_step?: string;
  escrow?: string;
  campaign_url?: string;
  fund_url?: string;
  sponsor_wallet?: string;
  chain_note?: string;
};
// Every sponsor reply, to check at the end that none mentions a tx hash.
const replies: string[] = [];
/** status as an agent sees it 15 s later: the per-ref chain-check cache has expired. */
async function status(ref: string, { cached = false } = {}) {
  // Age the last check past the 15 s window (exercises the claim of an existing row).
  if (!cached)
    await db`UPDATE chain_checks SET checked_at = checked_at - interval '20 seconds' WHERE ref = ${ref}`;
  const r = (await tools.sponsor_campaign(
    { action: 'status', ref },
    { installationId: inst },
  )) as Reply;
  replies.push(r.show_to_sponsor, r.next_step ?? '');
  return r;
}
const campaignOf = (sponsor: string, ref: string) =>
  wallet.readContract({
    address: process.env.ESCROW_FACTORY_ADDRESS as `0x${string}`,
    abi: campaignsAbi,
    functionName: 'campaignOf',
    args: [sponsor as `0x${string}`, ref as `0x${string}`],
  }) as Promise<string>;

// v2.2 §5: at most 3 entries per installation per campaign. Further entries in one campaign come
// from other builders' installations (one spare per campaign).
const spares = new Map<string, number>();
async function entrant(programId: string) {
  const [{ n }] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM projects
    WHERE program_id = ${programId} AND installation_id = ${builder} AND payout_wallet IS NOT NULL`;
  if (n < 3) return builder;
  if (!spares.has(programId)) {
    const [{ id }] = await db<{ id: number }[]>`
      INSERT INTO installations (token_hash) VALUES (${`e2e-spare-${programId}-${Date.now()}`}) RETURNING id`;
    spares.set(programId, id);
  }
  return spares.get(programId)!;
}

async function enter(
  programId: string,
  name: string,
  payout: string,
  installationId?: number,
) {
  const slug = name.toLowerCase().replace(/\W/g, '');
  const repo_url = `https://github.com/x/${slug}`;
  ownRepo(repo_url, payout);
  return recordSubmission(
    {
      program_id: programId,
      project: {
        name,
        description: `${name} does one useful thing on Base.`,
        repo_url,
        live_url: `https://${slug}.app`,
      },
      submission_data: { payout_wallet: payout },
    },
    installationId ?? (await entrant(programId)),
    github,
  );
}

// ---------------------------------------------------------------------------
// create: sponsor_wallet is required and bound; the reply names it and asks for no hashes.
// ---------------------------------------------------------------------------
const { sponsor_wallet: _w, ...unbound } = mkDraft('E2E unbound', '5', 4);
const noWallet = await tools
  .sponsor_campaign({ action: 'create', ...unbound }, { installationId: inst })
  .then(
    () => '',
    (err: Error) => err.message,
  );
check(
  /sponsor_wallet/.test(noWallet),
  'create without sponsor_wallet is refused',
);
const badChecksum = await tools
  .sponsor_campaign(
    {
      action: 'create',
      ...mkDraft('E2E bad checksum', '5', 4),
      sponsor_wallet: '0x70997970c51812dc3A010C7d01b50e0d17dc79C8',
    },
    { installationId: inst },
  )
  .then(
    () => '',
    (err: Error) => err.message,
  );
check(
  /checksum/.test(badChecksum),
  'a mixed-case sponsor_wallet with a bad checksum is refused',
);

// v2.2 §6: five answers are enough; the reply lists the defaults used. `theme` is still accepted
// (mkDraft uses it), as the old name of what_to_build.
const fiveAnswers = (await tools.sponsor_campaign(
  {
    action: 'create',
    sponsor_wallet: wallet.account.address,
    sponsor_name: 'E2E Co',
    title: 'E2E five answers',
    what_to_build: 'Build anything on Base that works end to end.',
    amount: '5',
  },
  { installationId: inst },
)) as Awaited<ReturnType<typeof createSponsorDraft>>;
const [fiveRow] = await sql()<{ draft: Record<string, unknown> }[]>`
  SELECT draft FROM sponsor_campaigns WHERE ref = ${fiveAnswers.ref}`;
check(
  fiveAnswers.show_to_sponsor.includes(
    'Defaults used: criteria: "E2E Co picks the most useful entries"; chains: base; token: USDC; ' +
      'winners: 3; existing projects can enter; ends ',
  ) &&
    fiveAnswers.show_to_sponsor.includes(
      '(14 days); no sponsor_url (the campaign shows as unverified). To change any, create it again before funding.',
    ) &&
    fiveRow.draft.winners === 3 &&
    fiveRow.draft.existing_work === 'allowed' &&
    fiveRow.draft.what_to_build ===
      'Build anything on Base that works end to end.' &&
    !('theme' in fiveRow.draft),
  `create with five answers uses the defaults and says so: ${JSON.stringify(fiveAnswers.show_to_sponsor)}`,
);

// ---------------------------------------------------------------------------
// Campaign A: draft -> fund -> (status finds it) -> entries -> award (ends in 4 days).
// ---------------------------------------------------------------------------
const draft = await createSponsorDraft(
  mkDraft('E2E campaign', '100', 4, 2),
  inst,
);
check(
  draft.transactions.length === 2,
  'draft returns approve + createCampaign',
);
replies.push(draft.show_to_sponsor, draft.next_step);
check(
  draft.show_to_sponsor.startsWith('Campaign drafted: "E2E campaign".') &&
    draft.show_to_sponsor.includes('Winners get 90 USDC') &&
    draft.show_to_sponsor.includes("EarnKit's 10% (10 USDC)") &&
    draft.show_to_sponsor.includes(
      `Fund it here, from ${SPONSOR}: ${draft.fund_url}`,
    ) &&
    draft.next_step.includes('action=status and ref') &&
    !('show_to_builder' in draft),
  'create replies with show_to_sponsor (split, deadline, bound wallet, fund link) and next_step',
);
console.log(`  show_to_sponsor: ${JSON.stringify(draft.show_to_sponsor)}`);
const [{ sponsor_wallet: storedWallet }] = await db<
  { sponsor_wallet: string }[]
>`SELECT sponsor_wallet FROM sponsor_campaigns WHERE ref = ${draft.ref}`;
check(
  storedWallet === SPONSOR,
  `the draft stores the bound wallet lowercased (${storedWallet})`,
);

const unfunded = await status(draft.ref);
check(
  unfunded.state === 'draft' && unfunded.sponsor_wallet === SPONSOR,
  'status before funding: still a draft (campaignOf is zero), naming the bound wallet',
);
await fund(draft.transactions);
check(
  (await status(draft.ref, { cached: true })).state === 'draft',
  'a status within 15 s of the last one reuses that chain read (still a draft)',
);
const liveA = await status(draft.ref);
check(
  liveA.state === 'live' &&
    liveA.escrow === (await campaignOf(SPONSOR, draft.ref)).toLowerCase(),
  'status finds the deposit onchain and publishes the campaign (escrow = campaignOf(wallet, ref))',
);
const programA = (await loadCampaign(draft.ref)).program_id!;
check((await status(draft.ref)).state === 'live', 'status again is idempotent');

const a = await enter(
  programA,
  'Alpha',
  '0x00000000000000000000000000000000000000a1',
);
const b = await enter(
  programA,
  'Beta',
  '0x00000000000000000000000000000000000000b2',
);
check(
  (await sponsorStatus(draft.ref, inst)).entries.length === 2,
  'two entries without contracts',
);

// The same repo, spelled differently, can't enter the same campaign twice.
let dupErr = '';
try {
  await recordSubmission(
    {
      program_id: programA,
      project: {
        name: 'Alpha again',
        description: 'Alpha, entered again by its owner.',
        repo_url: 'https://www.GitHub.com/X/Alpha.git/',
        live_url: 'https://a2.app',
      },
      submission_data: {
        payout_wallet: '0x00000000000000000000000000000000000000a1',
      },
    },
    builder,
    github,
  );
} catch (err) {
  dupErr = (err as Error).message;
}
check(
  dupErr ===
    `repo_url: this repo is already entered in this campaign (entry #${a.project_id}).`,
  `a second entry of the same repo is refused: ${dupErr}`,
);
// A squatter enters someone else's repo with their own wallet: the repo's earnkit.txt names the
// owner's wallet, so it is refused, and the owner's entry stands.
let squatErr = '';
await recordSubmission(
  {
    program_id: programA,
    project: {
      name: 'Beta copy',
      description: 'Not mine.',
      repo_url: 'https://github.com/x/beta',
      live_url: 'https://b.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000ee',
    },
  },
  builder,
  github,
).catch((err) => (squatErr = (err as Error).message));
check(
  squatErr.startsWith(
    'payout_wallet: earnkit.txt in github.com/x/beta says payout_wallet: 0x00000000000000000000000000000000000000b2',
  ),
  `a squatter can't enter someone else's repo: ${squatErr}`,
);
// A repo with no earnkit.txt is told exactly what to add; the sponsor can't enter its own campaign.
let noFileErr = '';
await recordSubmission(
  {
    program_id: programA,
    project: {
      name: 'No file',
      description: 'No proof.',
      repo_url: 'https://github.com/x/nofile',
      live_url: 'https://n.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000ef',
    },
  },
  builder,
  github,
).catch((err) => (noFileErr = (err as Error).message));
check(
  noFileErr.includes(
    'Add a file named earnkit.txt at the root of github.com/x/nofile on its default branch with the line "payout_wallet: 0x00000000000000000000000000000000000000ef"',
  ),
  'an entry without earnkit.txt is told which file and line to add',
);
ownRepo(
  'https://github.com/x/selfie',
  '0x00000000000000000000000000000000000000ab',
);
let selfErr = '';
await recordSubmission(
  {
    program_id: programA,
    project: {
      name: 'Selfie',
      description: 'The sponsor enters.',
      repo_url: 'https://github.com/x/selfie',
      live_url: 'https://s.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000ab',
    },
  },
  inst,
  github,
).catch((err) => (selfErr = (err as Error).message));
check(
  selfErr === "You created this campaign, so you can't enter it.",
  `the sponsor's installation can't enter its own campaign: ${selfErr}`,
);
// The last entry's payout wallet is remembered and prefilled, with a confirm note.
const prepared = (await tools.prepare_submission(
  { program_id: programA },
  { installationId: builder },
)) as { payout_wallet_note?: string };
check(
  prepared.payout_wallet_note ===
    'Using 0x00000000000000000000000000000000000000b2 from your last entry; confirm with the builder.',
  `prepare_submission prefills the last payout wallet: ${prepared.payout_wallet_note}`,
);
// Copied work: a fork is refused; a second entry of the same live link (spelled differently) is
// refused; the sponsor sees each entry's repo dates.
forks.add('x/forked');
ownRepo(
  'https://github.com/x/forked',
  '0x00000000000000000000000000000000000000a7',
);
const copyEntry = (name: string, repo: string, live: string) =>
  recordSubmission(
    {
      program_id: programA,
      project: {
        name,
        description: 'A copy.',
        repo_url: `https://github.com/x/${repo}`,
        live_url: live,
      },
      submission_data: {
        payout_wallet: '0x00000000000000000000000000000000000000a7',
      },
    },
    builder,
    github,
  ).then(
    () => '',
    (err) => (err as Error).message,
  );
check(
  (await copyEntry('Forked', 'forked', 'https://forked.app')) ===
    "Forks can't be entered; enter the original repo.",
  'a fork is refused',
);
ownRepo(
  'https://github.com/x/alphaclone',
  '0x00000000000000000000000000000000000000a7',
);
const liveDup = await copyEntry(
  'Alpha clone',
  'alphaclone',
  'HTTPS://www.Alpha.app/?ref=copy#top',
);
check(
  liveDup === `This live link is already entered (entry #${a.project_id}).`,
  `a second entry of the same live link is refused: ${liveDup}`,
);
const labelled = (await sponsorStatus(draft.ref, inst)).entries.find(
  (e) => e.entry_id === a.project_id,
) as { repo_label?: string; repo_created_at?: string } | undefined;
check(
  labelled?.repo_label ===
    'repo created 2026-09-01 · last push 2026-10-01 (at entry)' &&
    labelled.repo_created_at === '2026-09-01T00:00:00.000Z',
  `the sponsor sees the repo dates: ${labelled?.repo_label}`,
);
// Two concurrent entries of one new repo: exactly one gets in. They come from another builder
// (each installation may enter a campaign 3 times).
const [{ id: racer }] = await db<{ id: number }[]>`
  INSERT INTO installations (token_hash) VALUES (${'e2e-racer-' + Date.now()}) RETURNING id`;
ownRepo(
  'https://github.com/x/race',
  '0x00000000000000000000000000000000000000f1',
);
const racers = await Promise.allSettled(
  ['https://github.com/x/race', 'https://github.com/x/race/'].map(
    (repo_url, i) =>
      recordSubmission(
        {
          program_id: programA,
          project: {
            name: `Racer ${i}`,
            description: 'Races.',
            repo_url,
            live_url: 'https://r.app',
          },
          submission_data: {
            payout_wallet: '0x00000000000000000000000000000000000000f1',
          },
        },
        racer,
        github,
      ),
  ),
);
check(
  racers.filter((r) => r.status === 'fulfilled').length === 1,
  'two concurrent entries of the same repo: exactly one is stored',
);

const liveStatus = await status(draft.ref);
check(
  liveStatus.show_to_sponsor.startsWith(
    '"E2E campaign" is live: 3 entries; winners picked after ',
  ) &&
    liveStatus.show_to_sponsor.includes(`Pool in escrow ${liveStatus.escrow}`),
  `status (live) says entries, deadline and escrow: ${JSON.stringify(liveStatus.show_to_sponsor)}`,
);
check(
  await prepareAward(draft.ref, inst, {
    winners: [{ entry_id: a.project_id, amount: '90', reason: 'Works best' }],
  }).then(
    () => false,
    () => true,
  ),
  'award refused before the end',
);

// ---------------------------------------------------------------------------
// Campaign F (front-run): another wallet funds the sponsor's draft first with the exact same
// transactions. EarnKit never looks at it; the bound wallet's deposit is the campaign.
// ---------------------------------------------------------------------------
const draftF = await createSponsorDraft(
  mkDraft('E2E front-run', '10', 3.5),
  inst,
);
await fund(draftF.transactions, attacker);
const attackerEscrow = (
  await campaignOf(attacker.account.address, draftF.ref)
).toLowerCase();
check(
  /^0x[0-9a-f]{40}$/.test(attackerEscrow) && !/^0x0+$/.test(attackerEscrow),
  `the attacker's deposit made its own escrow ${attackerEscrow}`,
);
const afterAttack = await status(draftF.ref);
check(
  afterAttack.state === 'draft' &&
    !afterAttack.show_to_sponsor.includes(attackerEscrow),
  "status ignores the other wallet's deposit: still a draft, and it isn't shown",
);
await fund(draftF.transactions);
const liveF = await status(draftF.ref);
const escrowF = (await campaignOf(SPONSOR, draftF.ref)).toLowerCase();
check(
  liveF.state === 'live' &&
    liveF.escrow === escrowF &&
    escrowF !== attackerEscrow,
  "the bound wallet's deposit publishes the campaign with its own escrow, not the attacker's",
);
const attackerBefore = await balanceOf(attacker.account.address);
const refundStray =
  runCampaignCli(
    'refund',
    draftF.ref,
    '--escrow',
    attackerEscrow,
    '--reason',
    'no-eligible',
    '--execute',
  ) ?? '';
check(
  /refunded untracked escrow .* \(database unchanged\): 0x/.test(refundStray),
  '`campaign refund --escrow` refunds the stray deposit (no tx hash needed)',
);
check(
  (await balanceOf(attacker.account.address)) - attackerBefore ===
    parseUnits('10', 6),
  'the other wallet gets its full 10 USDC back',
);
check(
  (await loadCampaign(draftF.ref)).state === 'live',
  'campaign F stays live after the stray refund',
);

// ---------------------------------------------------------------------------
// Campaign M: the bound wallet deposits for the ref, but with a different amount than the draft.
// ---------------------------------------------------------------------------
const draftM = await createSponsorDraft(
  mkDraft('E2E wrong amount', '10', 3.5),
  inst,
);
const factory = process.env.ESCROW_FACTORY_ADDRESS as `0x${string}`;
await wallet.waitForTransactionReceipt({
  hash: await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [factory, parseUnits('11', 6)],
  }),
});
const endsAtM = BigInt(
  Math.floor(Date.parse((await loadCampaign(draftM.ref)).draft.ends_at) / 1000),
);
await wallet.waitForTransactionReceipt({
  hash: await wallet.writeContract({
    address: factory,
    abi: campaignsAbi,
    functionName: 'createCampaign',
    args: [draftM.ref, token, parseUnits('11', 6), endsAtM],
  }),
});
const mismatch = await status(draftM.ref);
check(
  mismatch.state === 'draft' &&
    mismatch.show_to_sponsor ===
      `"E2E wrong amount": a deposit from ${SPONSOR} was found for this campaign, but the deposited amount differs from the draft, so it wasn't published.` &&
    /Contact EarnKit to refund that deposit/.test(mismatch.next_step ?? ''),
  `a deposit with the wrong amount is refused and named: ${JSON.stringify(mismatch.show_to_sponsor)}`,
);
const strayM = (await campaignOf(SPONSOR, draftM.ref)).toLowerCase();
check(
  /refunded untracked escrow/.test(
    runCampaignCli(
      'refund',
      draftM.ref,
      '--escrow',
      strayM,
      '--reason',
      'no-eligible',
      '--execute',
    ) ?? '',
  ),
  'the operator refunds the mismatched deposit with `refund --escrow`',
);

// ---------------------------------------------------------------------------
// Campaign C: concurrent chain checks for the same ref publish exactly once.
// ---------------------------------------------------------------------------
const draftC = await createAndFund(mkDraft('E2E concurrent-check', '10', 3.5));
const rowC = await loadCampaign(draftC.ref);
await Promise.all([checkChain(rowC), checkChain(rowC), checkChain(rowC)]);
const c1 = await loadCampaign(draftC.ref);
const [{ n: programRows }] = await db<{ n: string }[]>`
  SELECT count(*)::text AS n FROM programs WHERE id = ${c1.program_id}`;
check(
  c1.state === 'live' && Number(programRows) === 1,
  'three concurrent chain checks publish exactly one program',
);

// ---------------------------------------------------------------------------
// Campaign 2: an expired draft, funded, rescued by status. Campaign 6: the same, rescued by
// `campaign sync <ref>`. Campaign S: rescued by `campaign sync` with no ref (the sweep).
// ---------------------------------------------------------------------------
const draft2 = await createAndFund(mkDraft('E2E expired-rescue', '10', 3.5));
const draft6 = await createAndFund(mkDraft('E2E sync-repair', '5', 3.5));
const draftS = await createAndFund(mkDraft('E2E sync-sweep', '5', 3.5));
await db`UPDATE sponsor_campaigns SET created_at = created_at - interval '8 days'
  WHERE ref IN (${draft2.ref}, ${draft6.ref}, ${draftS.ref})`;
check(
  (await loadCampaign(draft2.ref)).state === 'expired',
  'an 8-day-old draft lazily expires',
);
check(
  (await status(draft2.ref)).state === 'live',
  "status rescues the expired draft: the bound wallet's deposit is onchain",
);
await loadCampaign(draft6.ref); // lazily expires it
const syncOne = runCampaignCli('sync', draft6.ref) ?? '';
check(
  syncOne.includes(draft6.ref) &&
    /database expired -> live · chain says: funded/.test(syncOne),
  `\`campaign sync <ref>\` publishes the expired, funded draft: ${syncOne.trim()}`,
);
await loadCampaign(draftS.ref);
const sweep = runCampaignCli('sync') ?? '';
const sweepLine = sweep.split('\n').find((l) => l.startsWith(draftS.ref)) ?? '';
check(
  /database expired -> live/.test(sweepLine) && sweep.includes(draftF.ref),
  `\`campaign sync\` with no ref sweeps every draft, expired and live campaign: ${sweepLine}`,
);

// ---------------------------------------------------------------------------
// Drafts that lazily expire near/after their deadline; status says so without hashes.
// ---------------------------------------------------------------------------
const late = await createSponsorDraft(
  mkDraft('E2E late draft', '5', 3.5),
  inst,
);
await db`UPDATE sponsor_campaigns SET draft = jsonb_set(draft, '{ends_at}', to_jsonb(${new Date(Date.now() + 5 * 60_000).toISOString()}::text)) WHERE ref = ${late.ref}`;
const lateStatus = await status(late.ref);
check(
  lateStatus.state === 'expired' &&
    lateStatus.show_to_sponsor === DEADLINE_PASSED &&
    !lateStatus.fund_url,
  `a draft 5 minutes from its deadline expires; status: ${JSON.stringify(lateStatus.show_to_sponsor)}`,
);
check(
  /EarnKit finds it onchain/.test(lateStatus.next_step ?? ''),
  'its next_step says EarnKit finds a deposit onchain (no hash to send)',
);

// ---------------------------------------------------------------------------
// Campaigns funded now and used after the warp: 3 (off-plan award), 4 (takedown), 5 (fallback
// executed), 7 (no-eligible refund), 8 (fallback vetoed, then the sponsor reclaims).
// ---------------------------------------------------------------------------
const draft3 = await createAndFund(mkDraft('E2E off-plan award', '40', 3.5));
const draft4 = await createAndFund(mkDraft('E2E operator-refund', '15', 3.5));
const draft5 = await createAndFund(mkDraft('E2E operator-fallback', '20', 3.5));
const draft7 = await createAndFund(
  mkDraft('E2E no-eligible refund', '12', 3.5),
);
const draft8 = await createAndFund(mkDraft('E2E vetoed fallback', '12', 3.5));
for (const d of [draft3, draft4, draft5, draft7, draft8])
  check(
    (await status(d.ref)).state === 'live',
    `campaign "${(await loadCampaign(d.ref)).draft.title}" is live`,
  );
const prog = async (ref: string) => (await loadCampaign(ref)).program_id!;
const entryWallet = '0x00000000000000000000000000000000000000c3';
const nonEntryWallet = '0x00000000000000000000000000000000000000d4';
const gamma = await enter(await prog(draft3.ref), 'Gamma', entryWallet);
const eps = await enter(
  programA,
  'Epsilon',
  '0x00000000000000000000000000000000000000e1',
);
const theta = await enter(
  c1.program_id!,
  'Theta',
  '0x00000000000000000000000000000000000000e2',
);
// An entry whose payout wallet is another campaign's escrow (campaign C's).
const sneaky = await enter(programA, 'Sneaky', c1.escrow_address!);
// v2.2 §5: a fourth entry from one installation in one campaign is refused.
ownRepo(
  'https://github.com/x/fourth',
  '0x00000000000000000000000000000000000000e9',
);
const fourth = await recordSubmission(
  {
    program_id: programA,
    project: {
      name: 'Fourth',
      description: 'One entry too many.',
      repo_url: 'https://github.com/x/fourth',
      live_url: 'https://fourth.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000e9',
    },
  },
  builder,
  github,
).then(
  () => '',
  (e: Error) => e.message,
);
check(
  /already has 3 entries in this campaign/.test(fourth),
  `a 4th entry from one installation in one campaign is refused: ${fourth}`,
);
const zeta = await enter(
  await prog(draft4.ref),
  'Zeta',
  '0x00000000000000000000000000000000000000e3',
);
const delta = await enter(
  await prog(draft5.ref),
  'Delta',
  '0x00000000000000000000000000000000000000e5',
);
const sneaky5 = await enter(await prog(draft5.ref), 'Sneaky5', escrowF);
const eta = await enter(
  await prog(draft7.ref),
  'Eta',
  '0x00000000000000000000000000000000000000e4',
);
const iota = await enter(
  await prog(draft8.ref),
  'Iota',
  '0x00000000000000000000000000000000000000e6',
);
// ---------------------------------------------------------------------------
// Contracts in an entry count only if the transaction that created them was sent from the payout
// wallet (a contracts: line in earnkit.txt is ignored). On Base, EarnKit reads that from Blockscout
// (creation_transaction_hash, then the tx's from); here anvil stands in: the creation tx of each
// contract this script deployed, and that tx's sender. Contract status is read from anvil too.
// ---------------------------------------------------------------------------
const { fundTxs, findToken } = await import('../lib/earnkit/escrow');
const deployer = walletOf(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // anvil #5
);
const DEPLOYER = deployer.account.address.toLowerCase();
const creationTxs = new Map<string, `0x${string}`>();
const chainReads = {
  ...github,
  deployer: {
    creationTx: async (c: string) => creationTxs.get(c.toLowerCase()) ?? null,
    txSender: async (h: string) =>
      (await wallet.getTransaction({ hash: h as `0x${string}` })).from,
  },
  status: async (c: string) => {
    const code = await wallet.getCode({ address: c as `0x${string}` });
    return code && code !== '0x'
      ? ('during' as const)
      : ('not_contract' as const);
  },
};
// A factory (CREATE2) deploy sent by anvil #5: its own escrow clone, opened through the factory.
await mint(deployer.account.address, '1');
const cloneRef = `0x${'5'.repeat(64)}` as `0x${string}`;
const [approveTx, createTx] = fundTxs(
  cloneRef,
  findToken('USDC')!,
  parseUnits('1', 6),
  Number((await wallet.getBlock()).timestamp) + 4 * 86_400,
);
await deployer.waitForTransactionReceipt({
  hash: await deployer.sendTransaction({
    to: approveTx.to,
    data: approveTx.data,
  }),
});
const createHash = await deployer.sendTransaction({
  to: createTx.to,
  data: createTx.data,
});
await deployer.waitForTransactionReceipt({ hash: createHash });
const factoryBuilt = (await campaignOf(DEPLOYER, cloneRef)).toLowerCase();
creationTxs.set(factoryBuilt, createHash);
const { ref: contractsRef } = await createAndFund(
  mkDraft('E2E contracts', '5', 4),
);
check(
  (await status(contractsRef)).state === 'live',
  'campaign "E2E contracts" is live',
);
const contractsProgram = await prog(contractsRef);
const enterWith = async (name: string, payout: string, contracts: string[]) => {
  const repo_url = `https://github.com/x/${name.toLowerCase()}`;
  // The squatter's file lists the contract too: listing proves nothing.
  ownRepo(repo_url, payout, contracts);
  return recordSubmission(
    {
      program_id: contractsProgram,
      project: {
        name,
        description: `${name} on Base.`,
        repo_url,
        live_url: `https://${name.toLowerCase()}.app`,
      },
      submission_data: { payout_wallet: payout, contracts },
    },
    await entrant(contractsProgram),
    chainReads,
  );
};
// A squat of someone else's contract (from the squatter's own repo, file naming their own wallet
// and listing the contract) is refused; the deployer's entry then gets in.
let contractSquat = '';
await enterWith(
  'Squatter',
  '0x976ea74026e726554db657fa54763abd0c3a0aa9', // anvil #6
  [factoryBuilt],
).catch((err) => (contractSquat = (err as Error).message));
check(
  contractSquat ===
    `Contract ${factoryBuilt} was deployed by a different wallet. Enter contracts deployed from your payout wallet.`,
  `a squat of someone else's contract is refused: ${contractSquat}`,
);
const built = await enterWith('Builder5', DEPLOYER, [factoryBuilt]);
check(
  built.recorded === true,
  'a factory-deployed contract enters: the deploying tx was sent by the payout wallet',
);

// Warp past campaign A's and 3's end dates and reset A's stored ends_at to the real past, the
// same way a sponsor's deadline actually arrives.
await warpDays(6);
await db`UPDATE sponsor_campaigns SET draft = jsonb_set(draft, '{ends_at}', to_jsonb(${new Date(Date.now() - 1000).toISOString()}::text)) WHERE ref IN (${draft.ref}, ${draft5.ref}, ${draft8.ref})`;

// ---------------------------------------------------------------------------
// Campaign 3: off-plan award — the sponsor calls the escrow directly, with one entry's wallet and
// one wallet that isn't an entry. Status reads it from the chain.
// ---------------------------------------------------------------------------
const escrow3 = (await loadCampaign(draft3.ref))
  .escrow_address as `0x${string}`;
await wallet.waitForTransactionReceipt({
  hash: await wallet.writeContract({
    address: escrow3,
    abi: campaignAbi,
    functionName: 'award',
    args: [
      [entryWallet, nonEntryWallet],
      [parseUnits('20', 6), parseUnits('16', 6)],
    ],
  }),
});
const offPlanStatus = await status(draft3.ref);
check(
  offPlanStatus.state === 'awarded' &&
    offPlanStatus.show_to_sponsor.startsWith(
      '"E2E off-plan award" is awarded: 2 winners paid.',
    ),
  `status reads the off-plan award from the chain: ${JSON.stringify(offPlanStatus.show_to_sponsor)}`,
);
const [gammaRow] = await db<{ prize_amount: string; prize_tx: string }[]>`
  SELECT prize_amount, prize_tx FROM projects WHERE id = ${gamma.project_id}`;
check(
  gammaRow.prize_amount === '20' && /^0x[0-9a-f]{64}$/.test(gammaRow.prize_tx),
  "Gamma's prize is recorded as 20, with the award's tx from the Awarded log",
);
const [offPlanRow] = await db<
  { award_onchain: { wallet: string; entry_id: number | null }[] }[]
>`SELECT award_onchain FROM sponsor_campaigns WHERE ref = ${draft3.ref}`;
check(
  offPlanRow.award_onchain.find((o) => o.wallet === nonEntryWallet)
    ?.entry_id === null,
  'award_onchain flags the non-entry wallet with entry_id: null',
);
check(
  await prepareAward(draft3.ref, inst, {
    winners: [{ entry_id: gamma.project_id, amount: '1', reason: 'x x x' }],
  }).then(
    () => false,
    () => true,
  ),
  'prepareAward refuses an already-awarded campaign',
);

// ---------------------------------------------------------------------------
// Campaign A's own award: prepareAward, the sponsor signs, status reads it.
// ---------------------------------------------------------------------------
const sneakyErr = await prepareAward(draft.ref, inst, {
  winners: [{ entry_id: sneaky.project_id, amount: '90', reason: 'Sneaky' }],
}).then(
  () => '',
  (err: Error) => err.message,
);
check(
  sneakyErr ===
    `winners: entry ${sneaky.project_id}'s payout wallet is an EarnKit escrow or the sponsor's wallet, so it can't receive a prize.`,
  `an award to another campaign's escrow is refused: ${sneakyErr}`,
);
// Awards by ranking: exact shares, the remainder to first place, the default reason.
const ranked = await prepareAward(draft.ref, inst, {
  winners: [a.project_id, b.project_id],
  split: [67, 33],
});
check(
  ranked.plan.map((p) => p.amount).join(',') === '60.3,29.7' &&
    ranked.sponsor_content.reasons.every(
      (r) => r.reason === 'Picked by E2E Co',
    ),
  `a ranking with a split gets exact amounts and "Picked by <sponsor>": ${JSON.stringify(ranked.plan)}`,
);
const rankedEqual = await prepareAward(draft.ref, inst, {
  winners: [b.project_id, a.project_id],
});
check(
  rankedEqual.plan.map((p) => `${p.entry_id}:${p.amount}`).join(',') ===
    `${b.project_id}:45,${a.project_id}:45`,
  'a ranking without a split shares the prize equally, in rank order',
);
const badSplit = await prepareAward(draft.ref, inst, {
  winners: [a.project_id, b.project_id],
  split: [60, 30],
}).then(
  () => '',
  (err: Error) => err.message,
);
check(
  badSplit === 'split: percentages must add up to 100 (got 90).',
  `a split that doesn't add up to 100 is refused: ${badSplit}`,
);
const award = await prepareAward(draft.ref, inst, {
  winners: [
    { entry_id: a.project_id, amount: '60', reason: 'Works best' },
    { entry_id: b.project_id, amount: '30', reason: 'Runner-up' },
  ],
});
replies.push(award.show_to_sponsor, award.next_step);
check(
  award.show_to_sponsor ===
    'Award ready:\n' +
      `- entry #${a.project_id} "Alpha": 60 USDC\n` +
      `- entry #${b.project_id} "Beta": 30 USDC\n` +
      "EarnKit's 10% (10 USDC) is released with this payout.\n" +
      `Sign it here: ${award.award_url}` &&
    award.next_step.includes(award.award_url) &&
    award.sponsor_content.reasons[0].reason === 'Works best',
  'award replies with each winner by entry and quoted name, the fee, award_url, next_step and reasons as data',
);
const names = await entryNames([a.project_id, b.project_id]);
check(
  names.get(a.project_id) === 'Alpha' && names.get(b.project_id) === 'Beta',
  'the award page can name each winner',
);
check(
  (await status(draft.ref)).next_step?.includes(award.award_url) === true,
  'status after the deadline with a prepared award points at award_url',
);
await wallet.waitForTransactionReceipt({
  hash: await wallet.sendTransaction({
    to: award.transaction.to,
    data: award.transaction.data,
  }),
});
const awardedStatus = await status(draft.ref);
check(
  awardedStatus.state === 'awarded' &&
    awardedStatus.show_to_sponsor.startsWith(
      '"E2E campaign" is awarded: 2 winners paid.',
    ),
  `status reads the sponsor's award from the chain: ${JSON.stringify(awardedStatus.show_to_sponsor)}`,
);
check(
  (await balanceOf('0x00000000000000000000000000000000000000a1')) ===
    parseUnits('60', 6),
  'winner A received 60 USDC',
);
check(
  (await balanceOf(treasury)) === parseUnits('14', 6),
  "EarnKit's 10% fees (4 + 10 USDC) reached the treasury",
);
check(
  await prepareAward(draft.ref, inst, {
    winners: [{ entry_id: a.project_id, amount: '1', reason: 'x x x' }],
  }).then(
    () => false,
    () => true,
  ),
  'prepareAward refuses campaign A once it is awarded too',
);
check(
  presentYourEntries(await yourCampaignEntries(builder), null).wins.includes(
    'you won 60 USDC with Alpha',
  ),
  '"you won 60 USDC with Alpha"',
);

// ---------------------------------------------------------------------------
// Campaign 4: operator takedown refund. Campaign 7: no-eligible refund.
// ---------------------------------------------------------------------------
const sponsorBefore = await balanceOf(SPONSOR);
const refundOut =
  runCampaignCli('refund', draft4.ref, '--reason', 'takedown', '--execute') ??
  '';
check(
  /refunded: 0x/.test(refundOut) &&
    /goes back to the sponsor 0x/i.test(refundOut),
  '`campaign refund --execute` refunds the sponsor and says who receives the money',
);
check(
  (await balanceOf(SPONSOR)) - sponsorBefore === parseUnits('15', 6),
  "the sponsor's balance increases by the full deposit on takedown refund",
);
check(
  (await loadCampaign(draft4.ref)).state === 'taken_down',
  'campaign 4 is marked taken_down',
);
check(
  /chain says: refunded/.test(runCampaignCli('sync', draft4.ref) ?? '') &&
    (await status(draft4.ref)).state === 'taken_down',
  '`campaign sync` prints the chain state; taken_down stays taken_down',
);
const refundAgain = runCampaignCliFails(
  {},
  'refund',
  draft4.ref,
  '--reason',
  'takedown',
  '--execute',
);
check(
  refundAgain.status === 1 &&
    refundAgain.stderr ===
      "The escrow isn't Funded onchain (chain says: refunded); nothing to refund.",
  `refunding twice is refused in one line: ${refundAgain.stderr}`,
);
const badKey = runCampaignCliFails(
  { OPERATOR_PRIVATE_KEY: 'abc' },
  'refund',
  draft4.ref,
  '--reason',
  'takedown',
  '--execute',
);
check(
  badKey.stderr ===
    'OPERATOR_PRIVATE_KEY must be 0x followed by 64 hex characters.',
  `a malformed operator key is refused: ${badKey.stderr}`,
);
const missingRef = runCampaignCliFails({}, 'sync', `0x${'0'.repeat(64)}`);
check(
  missingRef.status === 1 &&
    !missingRef.stderr.includes('\n') &&
    !missingRef.stderr.includes('    at '),
  `an unknown ref is one readable line, no stack trace: ${missingRef.stderr}`,
);
const oldTx = runCampaignCliFails({}, 'award', draft5.ref);
check(
  /^Unknown command "award"/.test(oldTx.stderr),
  'the old operator `award` command is gone',
);
const help = execFileSync(tsxBin, [campaignScript, '--help'], {
  encoding: 'utf8',
});
check(
  ['score', 'rank', 'payout', 'refund'].every((c) =>
    new RegExp(`\\n  ${c} +<`).test(help),
  ) &&
    ['propose', 'execute', 'veto'].every((c) =>
      new RegExp(`\\n  fallback ${c} +<ref>`).test(help),
    ) &&
    /\n  sync +\[<ref>\]/.test(help) &&
    !help.includes('--tx'),
  '`campaign --help` lists every command, and no --tx',
);
check(
  /refunded: 0x/.test(
    runCampaignCli(
      'refund',
      draft7.ref,
      '--reason',
      'no-eligible',
      '--execute',
    ) ?? '',
  ),
  'campaign 7 refunded (no-eligible)',
);

// ---------------------------------------------------------------------------
// Statuses on the board, the entry page, and "Your campaign entries".
// ---------------------------------------------------------------------------
const boardA = (await getCampaignBoard(programA))!;
const statusOf = (board: NonNullable<typeof boardA>, id: number) => {
  const r = board.rows.find((x) => x.id === id)!;
  return entryStatus(board.program.campaign, r, board.sponsorState);
};
check(
  statusOf(boardA, a.project_id) === 'won 60 USDC',
  'board: Alpha "won 60 USDC"',
);
check(
  statusOf(boardA, eps.project_id) === 'not picked',
  'board: Epsilon "not picked"',
);
const board7 = (await getCampaignBoard(await prog(draft7.ref)))!;
check(
  statusOf(board7, eta.project_id) === 'no winners — sponsor refunded',
  'board: Eta "no winners — sponsor refunded"',
);
const boardC = (await getCampaignBoard(c1.program_id!))!;
check(
  statusOf(boardC, theta.project_id) === 'entered',
  'board: Theta (live) "entered"',
);
check(
  (await getCampaignBoard(await prog(draft4.ref))) === null &&
    (await getProjectPage(zeta.project_id)) === null,
  'a taken-down campaign board and entry page are 404',
);
const yours =
  presentYourEntries(await yourCampaignEntries(builder), null).section ?? '';
const lineFor = (name: string) =>
  yours
    .split('\n')
    .find((l) => l.startsWith(`${name} `) || l.startsWith(`${name}:`)) ?? '';
check(
  lineFor('Epsilon') === 'Epsilon in "E2E campaign": not picked this time' &&
    lineFor('Eta') ===
      'Eta in "E2E no-eligible refund": no winners; the sponsor was refunded' &&
    lineFor('Zeta') ===
      'Zeta in "E2E operator-refund": removed by EarnKit; the sponsor was refunded' &&
    /^Theta in "E2E concurrent-check": entered · winners picked after /.test(
      lineFor('Theta'),
    ),
  'your entries: not picked / refunded / removed / entered',
);

// ---------------------------------------------------------------------------
// Campaign 5: the operator fallback. Campaign 5's onchain endsAt is ~3.5 days after creation;
// proposals open at endsAt + 7 days. The chain is 6 days in.
// ---------------------------------------------------------------------------
const winners5 = `${delta.project_id}:18:Operator fallback award`;
const tooEarly = runCampaignCliFails(
  {},
  'fallback',
  'propose',
  draft5.ref,
  '--winners',
  winners5,
  '--execute',
);
check(
  /^The fallback opens on [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2} UTC\.$/.test(
    tooEarly.stderr,
  ),
  `a proposal before endsAt + 7 days is refused: ${tooEarly.stderr}`,
);
await warpDays(8);
const sneakyFallback = runCampaignCliFails(
  {},
  'fallback',
  'propose',
  draft5.ref,
  '--winners',
  `${sneaky5.project_id}:18:x`,
  '--execute',
);
check(
  /payout wallet is an EarnKit escrow/.test(sneakyFallback.stderr),
  `the fallback refuses a winner that is an EarnKit escrow: ${sneakyFallback.stderr}`,
);
const dry =
  runCampaignCli('fallback', 'propose', draft5.ref, '--winners', winners5) ??
  '';
check(
  /Dry run\. Add --execute to propose/.test(dry),
  '`fallback propose` without --execute is a dry run',
);
const proposed =
  runCampaignCli(
    'fallback',
    'propose',
    draft5.ref,
    '--winners',
    winners5,
    '--execute',
  ) ?? '';
const execAt = (out: string) =>
  /Executable from ([A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2} UTC)/.exec(
    out,
  )?.[1];
check(
  /proposed: 0x/.test(proposed) && execAt(proposed),
  `\`fallback propose --execute\` proposes and prints the execute time (${execAt(proposed)})`,
);
const pending = await status(draft5.ref);
check(
  pending.show_to_sponsor.includes(
    `EarnKit has proposed fallback winners; they can be paid from ${execAt(proposed)} unless the sponsor awards first.`,
  ),
  `status says a fallback is pending, with its execute time: ${JSON.stringify(pending.show_to_sponsor)}`,
);
check(
  (runCampaignCli('sync', draft5.ref) ?? '').includes(
    `fallback pending, executable from ${execAt(proposed)}`,
  ),
  '`campaign sync` shows the pending proposal',
);
await warpDays(1);
// The fallback also takes a ranking (v2.2 §6): entry ids, the prize split by planAward's rules.
const badFallbackSplit = runCampaignCliFails(
  {},
  'fallback',
  'propose',
  draft5.ref,
  '--winners',
  `${delta.project_id}`,
  '--split',
  '60,30',
);
check(
  badFallbackSplit.stderr ===
    'split: give one percentage per winner (1); got 2.',
  `the fallback refuses a split that doesn't match the ranking: ${badFallbackSplit.stderr}`,
);
const reproposed =
  runCampaignCli(
    'fallback',
    'propose',
    draft5.ref,
    '--winners',
    `${delta.project_id}`,
    '--execute',
  ) ?? '';
check(
  reproposed.includes(
    `#${delta.project_id} 0x00000000000000000000000000000000000000e5 18 USDC: Top entry (EarnKit fallback)`,
  ),
  `a ranked fallback gets the whole prize and the default reason: ${reproposed.split('\n')[0]}`,
);
check(
  /proposed: 0x/.test(reproposed) && execAt(reproposed) !== execAt(proposed),
  `re-proposing restarts the 72-hour delay (${execAt(proposed)} -> ${execAt(reproposed)})`,
);
await warpDays(2);
const execEarly = runCampaignCliFails(
  {},
  'fallback',
  'execute',
  draft5.ref,
  '--execute',
);
check(
  execEarly.stderr ===
    `The fallback can be executed from ${execAt(reproposed)}.`,
  `executing before the delay is refused: ${execEarly.stderr}`,
);
await warpDays(1.1);
const executed =
  runCampaignCli('fallback', 'execute', draft5.ref, '--execute') ?? '';
check(
  /executed: 0x.* \(database live -> awarded\)/.test(executed),
  `\`fallback execute\` pays the proposal and status records it: ${executed.trim().split('\n').pop()}`,
);
const [deltaRow] = await db<{ prize_amount: string; prize_reason: string }[]>`
  SELECT prize_amount, prize_reason FROM projects WHERE id = ${delta.project_id}`;
check(
  deltaRow.prize_amount === '18' &&
    deltaRow.prize_reason === 'Top entry (EarnKit fallback)' &&
    (
      await db<{ award_onchain: unknown }[]>`
      SELECT award_onchain FROM sponsor_campaigns WHERE ref = ${draft5.ref}`
    )[0].award_onchain === null,
  "Delta's prize (18 USDC) is recorded against the fallback plan (not off-plan)",
);

// ---------------------------------------------------------------------------
// Campaign 8: propose -> guardian veto -> re-propose refused (sticky) -> the sponsor reclaims.
// ---------------------------------------------------------------------------
const winners8 = `${iota.project_id}:10.8:Top entry`;
check(
  /proposed: 0x/.test(
    runCampaignCli(
      'fallback',
      'propose',
      draft8.ref,
      '--winners',
      winners8,
      '--execute',
    ) ?? '',
  ),
  'campaign 8: fallback proposed',
);
const vetoNoKey = runCampaignCliFails(
  {},
  'fallback',
  'veto',
  draft8.ref,
  '--execute',
);
check(
  vetoNoKey.stderr === 'Set GUARDIAN_PRIVATE_KEY in your local shell.',
  `the veto needs GUARDIAN_PRIVATE_KEY: ${vetoNoKey.stderr}`,
);
const vetoAsOperator = runCampaignCliFails(
  { GUARDIAN_PRIVATE_KEY: operatorKey },
  'fallback',
  'veto',
  draft8.ref,
  '--execute',
);
check(
  vetoAsOperator.stderr ===
    'The contract function "vetoFallback" reverted: NotAllowed.',
  `the operator can't veto its own proposal: ${vetoAsOperator.stderr}`,
);
check(
  /vetoed: 0x/.test(
    runCampaignCliAs(
      { GUARDIAN_PRIVATE_KEY: guardianKey },
      'fallback',
      'veto',
      draft8.ref,
      '--execute',
    ) ?? '',
  ),
  'the guardian vetoes the proposal',
);
check(
  !(await status(draft8.ref)).show_to_sponsor.includes(
    'proposed fallback winners',
  ),
  'status no longer mentions a pending fallback',
);
const repropose8 = runCampaignCliFails(
  {},
  'fallback',
  'propose',
  draft8.ref,
  '--winners',
  winners8,
  '--execute',
);
check(
  /guardian vetoed the fallback/.test(repropose8.stderr),
  `after a veto, re-proposing is refused (the veto is sticky): ${repropose8.stderr}`,
);
const exec8 = runCampaignCliFails(
  {},
  'fallback',
  'execute',
  draft8.ref,
  '--execute',
);
check(
  exec8.stderr === 'No fallback is pending onchain for this campaign.',
  `nothing to execute after a veto: ${exec8.stderr}`,
);
// The sponsor reclaims after endsAt + 60 days, outside EarnKit; status reads the refund.
await warpDays(50);
const escrow8 = (await loadCampaign(draft8.ref))
  .escrow_address as `0x${string}`;
await wallet.waitForTransactionReceipt({
  hash: await wallet.writeContract({
    address: escrow8,
    abi: campaignAbi,
    functionName: 'refund',
  }),
});
check(
  (await status(draft8.ref)).state === 'refunded',
  "status reads the sponsor's own reclaim from the chain: refunded",
);

// ---------------------------------------------------------------------------
// No sponsor reply asks for or shows a transaction hash.
// ---------------------------------------------------------------------------
// EarnKit's own campaign payout screens every winner before printing or signing. In production
// with BASE_RPC_URL not on Base mainnet (here: anvil), the screen refuses (fails closed), even for
// a dry run; the real oracle is never called.
// ---------------------------------------------------------------------------
await db`UPDATE programs SET ends_at = now() - interval '1 day' WHERE id = 'earnkit-campaign-1-base'`;
const [ekEntry] = await db<{ id: number }[]>`
  INSERT INTO projects (program_id, name, payout_wallet, contracts, score)
  VALUES ('earnkit-campaign-1-base', 'EK winner', '0x00000000000000000000000000000000000000c9',
    ${['0x00000000000000000000000000000000000000ca']}::text[], 100) RETURNING id`;
const payoutRefused = runCampaignCliFails(
  { NODE_ENV: 'production', BASE_RPC_URL: RPC },
  'payout',
  'earnkit-campaign-1-base',
  '--winners',
  String(ekEntry.id),
);
check(
  payoutRefused.stderr.includes(
    "Can't check this wallet right now; try again shortly.",
  ),
  `campaign payout screens winners before signing (fails closed): ${payoutRefused.stderr}`,
);

// ---------------------------------------------------------------------------
// Refs (64 hex) appear in fund/award links; any other 64-hex value would be a tx hash.
const refs = new Set(
  (await db<{ ref: string }[]>`SELECT ref FROM sponsor_campaigns`).map(
    (r) => r.ref,
  ),
);
const withHash = replies.filter(
  (r) =>
    (r.match(/0x[0-9a-fA-F]{64}/g) ?? []).some((h) => !refs.has(h)) ||
    /\b(tx|hash)\b/i.test(r),
);
check(
  withHash.length === 0,
  `no show_to_sponsor/next_step mentions a tx or hash (${replies.length} replies checked)${withHash.length ? `: ${withHash[0]}` : ''}`,
);

await db.end();
console.log('E2E PASSED');
