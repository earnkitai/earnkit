import './env.mts';
import { execFileSync } from 'node:child_process';
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
import type { Draft } from '../lib/earnkit/sponsor-rules';

/**
 * Full sponsor flow on a local anvil with the contracts deployed (Task 3 Step 3):
 *   ESCROW_CHAIN=local ESCROW_RPC_URL=http://127.0.0.1:8547 ESCROW_FACTORY_ADDRESS=… ESCROW_LOCAL_TOKEN=…
 *   DATABASE_URL=… pnpm sponsor:e2e
 * Anvil time is warped past deadlines; nothing touches a real network.
 *
 * Beyond the basic draft -> fund -> entries -> award flow, this script also exercises (Task 10
 * binding requirements, deferred here from Tasks 6-9):
 *   1. two concurrent confirmFunding(ref, tx) calls for the same ref (race safety)
 *   2. an expired draft rescued by a late but valid funding receipt
 *   3. an off-plan award (the sponsor calls the escrow directly) with a non-entry wallet
 *   4. prepareAward refused once a campaign is already awarded
 *   5. the operator CLI commands (refund, sync, fallback award) against the same anvil
 *   6. re-confirming a live campaign with its own funding tx (confirmTx and the status tool)
 *   7. a second deposit for the same ref from another wallet: a readable error naming the
 *      untracked escrow, then `campaign refund --escrow <address>` returns it
 *   8. `campaign sync <ref> --tx <hash>` repairing an expired, funded draft to live
 * and, from the v2.1 end-to-end test's fix list:
 *   9. the same repo entered twice (any spelling) is refused (item 1)
 *  10. a draft whose deadline is under 10 minutes away lazily expires (item 2)
 *  11. entry statuses: entered, not picked, refunded, taken down (board, entry page, and
 *      list_programs' "Your campaign entries") (items 3/4)
 *  12. sponsor replies (show_to_sponsor + next_step), award page names, the operator CLI's
 *      refusals, and Campaign #1's page being gone (items 5, 7, 9, 11)
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
const treasury = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // anvil #3 (TREASURY at deploy)
const wallet = createWalletClient({
  account: privateKeyToAccount(sponsorKey),
  chain: foundry,
  transport: http(RPC),
}).extend(publicActions);
const rpc = (method: string, params: unknown[]) =>
  fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
const warpDays = async (days: number) => {
  await rpc('evm_increaseTime', [days * 86_400]);
  await rpc('evm_mine', []);
};

const { sql } = await import('../lib/earnkit/db');
const {
  createSponsorDraft,
  confirmFunding,
  sponsorStatus,
  prepareAward,
  confirmAward,
  fundingFromReceipt,
  loadCampaign,
  confirmTx,
} = await import('../lib/earnkit/sponsor');
const { tools } = await import('../lib/earnkit/tools');
const { recordSubmission } = await import('../lib/earnkit/projects');
const { presentYourEntries, entryStatus } = await import(
  '../lib/earnkit/campaigns'
);
const { getCampaignBoard, getProjectPage, yourCampaignEntries, entryNames } =
  await import('../lib/earnkit/leaderboard');
const { DEADLINE_PASSED } = await import('../lib/earnkit/sponsor');
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
/** Runs the CLI expecting it to fail; returns its stderr (one line, no stack trace). */
function runCampaignCliFails(env: Record<string, string>, ...args: string[]) {
  try {
    execFileSync(tsxBin, [campaignScript, ...args], {
      env: { ...process.env, OPERATOR_PRIVATE_KEY: operatorKey, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    const e = err as { status: number; stderr: string };
    return { status: e.status, stderr: e.stderr.trim() };
  }
  fail(`campaign ${args.join(' ')} was expected to fail but succeeded`);
}

function runCampaignCli(...args: string[]) {
  try {
    return execFileSync(tsxBin, [campaignScript, ...args], {
      env: { ...process.env, OPERATOR_PRIVATE_KEY: operatorKey },
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    fail(
      `campaign ${args.join(' ')} failed: ${e.stderr || e.stdout || e.message}`,
    );
  }
}

const [{ id: inst }] = await db<{ id: number }[]>`
  INSERT INTO installations (token_hash) VALUES (${'e2e-' + Date.now()}) RETURNING id`;
const token = process.env.ESCROW_LOCAL_TOKEN as `0x${string}`;
await wallet.writeContract({
  address: token,
  abi: [
    {
      type: 'function',
      name: 'mint',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ],
  functionName: 'mint',
  args: [wallet.account.address, parseUnits('1000', 6)],
});

const DAY = 86_400_000;
function mkDraft(
  title: string,
  amount: string,
  endsInDays: number,
  winners = 1,
): Draft {
  return {
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

/** Creates a draft and sends its approve + createCampaign transactions. Does not confirm. */
async function createAndFund(input: Draft) {
  const draft = await createSponsorDraft(input, inst);
  let fundTx: `0x${string}` = '0x';
  for (const tx of draft.transactions) {
    fundTx = await wallet.sendTransaction({ to: tx.to, data: tx.data });
    await wallet.waitForTransactionReceipt({ hash: fundTx });
  }
  return { ref: draft.ref, fundTx, draft };
}

// ---------------------------------------------------------------------------
// Campaign A: the core draft -> fund -> entries -> award flow (ends in 4 days).
// ---------------------------------------------------------------------------
const endsA = new Date(Date.now() + 4 * DAY).toISOString();
const draft = await createSponsorDraft(
  mkDraft('E2E campaign', '100', 4, 2),
  inst,
);
check(
  draft.transactions.length === 2,
  'draft returns approve + createCampaign',
);
check(
  draft.show_to_sponsor.startsWith('Campaign drafted: E2E campaign.') &&
    draft.show_to_sponsor.includes('Winners get 90 USDC') &&
    draft.show_to_sponsor.includes("EarnKit's 10% (10 USDC)") &&
    draft.show_to_sponsor.includes(`Fund it here: ${draft.fund_url}`) &&
    draft.next_step.includes('action=status') &&
    !('show_to_builder' in draft),
  'create replies with show_to_sponsor (split, deadline, fund link) and next_step',
);
console.log(`  show_to_sponsor: ${JSON.stringify(draft.show_to_sponsor)}`);

let fundTx: `0x${string}` = '0x';
for (const tx of draft.transactions) {
  fundTx = await wallet.sendTransaction({ to: tx.to, data: tx.data });
  await wallet.waitForTransactionReceipt({ hash: fundTx });
}
const live = await confirmFunding(draft.ref, fundTx);
check(
  live.program_id.startsWith('sponsor-'),
  'funding confirmed, program live',
);
check(
  (await confirmFunding(draft.ref, fundTx)).program_id === live.program_id,
  'confirm twice is idempotent',
);

const approveTx = await wallet.sendTransaction({
  to: draft.transactions[0].to,
  data: draft.transactions[0].data,
});
const approveReceipt = await wallet.waitForTransactionReceipt({
  hash: approveTx,
});
let rejected = false;
try {
  fundingFromReceipt(
    {
      ref: draft.ref,
      token,
      token_decimals: 6,
      amount: '100',
      draft: { ends_at: endsA },
    },
    approveReceipt,
  );
} catch {
  rejected = true;
}
check(rejected, 'a non-funding tx is rejected');

const a = await recordSubmission(
  {
    program_id: live.program_id,
    project: {
      name: 'Alpha',
      repo_url: 'https://github.com/x/a',
      live_url: 'https://a.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000a1',
    },
  },
  inst,
);
const b = await recordSubmission(
  {
    program_id: live.program_id,
    project: {
      name: 'Beta',
      repo_url: 'https://github.com/x/b',
      live_url: 'https://b.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000b2',
    },
  },
  inst,
);
check(
  (await sponsorStatus(draft.ref, inst)).entries.length === 2,
  'two entries without contracts',
);

// Item 1: the same repo, spelled differently, can't enter the same campaign twice.
let dupErr = '';
try {
  await recordSubmission(
    {
      program_id: live.program_id,
      project: {
        name: 'Alpha again',
        repo_url: 'https://www.GitHub.com/X/A.git/',
        live_url: 'https://a2.app',
      },
      submission_data: {
        payout_wallet: '0x00000000000000000000000000000000000000a9',
      },
    },
    inst,
  );
} catch (err) {
  dupErr = (err as Error).message;
}
check(
  dupErr === `repo_url: already entered as "Alpha" (entry #${a.project_id}).`,
  `a second entry of the same repo is refused: ${dupErr}`,
);
const [{ n: alphaRows }] = await db<{ n: string }[]>`
  SELECT count(*)::text AS n FROM projects WHERE program_id = ${live.program_id} AND name LIKE 'Alpha%'`;
check(Number(alphaRows) === 1, 'the duplicate was not stored');
// Two concurrent entries of one new repo: exactly one gets in.
const racers = await Promise.allSettled(
  ['https://github.com/x/race', 'https://github.com/x/race/'].map(
    (repo_url, i) =>
      recordSubmission(
        {
          program_id: live.program_id,
          project: { name: `Racer ${i}`, repo_url, live_url: 'https://r.app' },
          submission_data: {
            payout_wallet: '0x00000000000000000000000000000000000000f1',
          },
        },
        inst,
      ),
  ),
);
check(
  racers.filter((r) => r.status === 'fulfilled').length === 1,
  'two concurrent entries of the same repo: exactly one is stored',
);
const racer = racers.find(
  (r) => r.status === 'fulfilled',
) as PromiseFulfilledResult<{ project_id: number }>;

const liveStatus = (await tools.sponsor_campaign(
  { action: 'status', ref: draft.ref },
  { installationId: inst },
)) as {
  show_to_sponsor: string;
  next_step?: string;
  escrow?: string;
  escrow_url?: string;
};
check(
  liveStatus.show_to_sponsor.startsWith(
    'E2E campaign is live: 3 entries; winners picked after ',
  ) &&
    liveStatus.show_to_sponsor.includes(`Pool in escrow ${liveStatus.escrow}`),
  `status (live) says entries, deadline and escrow: ${JSON.stringify(liveStatus.show_to_sponsor)}`,
);

let early = false;
try {
  await prepareAward(draft.ref, inst, [
    { entry_id: a.project_id, amount: '90', reason: 'Works best' },
  ]);
} catch {
  early = true;
}
check(early, 'award refused before the end');

// ---------------------------------------------------------------------------
// Campaign C: two concurrent confirmFunding(ref, tx) calls for the same ref (binding item 1).
// ---------------------------------------------------------------------------
const draftC = await createAndFund(
  mkDraft('E2E concurrent-confirm', '10', 3.5),
);
const [c1, c2] = await Promise.all([
  confirmFunding(draftC.ref, draftC.fundTx),
  confirmFunding(draftC.ref, draftC.fundTx),
]);
check(
  c1.program_id === c2.program_id,
  'two concurrent confirms return the same program_id',
);
const [{ n: programRows }] = await db<{ n: string }[]>`
  SELECT count(*)::text AS n FROM programs WHERE id = ${c1.program_id}`;
check(
  Number(programRows) === 1,
  'exactly one programs row exists after the concurrent confirm',
);

// ---------------------------------------------------------------------------
// Re-confirm a live campaign with its funding tx (I-2): routed as funding by the receipt's
// contents, not sent to confirmAward because the row is live.
// ---------------------------------------------------------------------------
const reconfirm = await confirmTx(draftC.ref, draftC.fundTx);
check(
  reconfirm.confirmed === 'funding' &&
    'program_id' in reconfirm &&
    reconfirm.program_id === c1.program_id,
  're-confirming a live campaign with its funding tx returns the live result',
);
const viaTool = (await tools.sponsor_campaign(
  { action: 'status', ref: draftC.ref, tx: draftC.fundTx },
  { installationId: inst },
)) as { state: string; campaign_url?: string };
check(
  viaTool.state === 'live' &&
    viaTool.campaign_url?.endsWith(`/campaigns/${c1.program_id}`) === true,
  'status with the funding tx on a live campaign reports it live (no award error)',
);

// ---------------------------------------------------------------------------
// A second deposit for campaign C's ref from another wallet (anvil #4): an untracked escrow.
// ---------------------------------------------------------------------------
const sponsor2 = createWalletClient({
  account: privateKeyToAccount(
    '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  ), // anvil #4
  chain: foundry,
  transport: http(RPC),
}).extend(publicActions);
await sponsor2.waitForTransactionReceipt({
  hash: await wallet.writeContract({
    address: token,
    abi: [
      {
        type: 'function',
        name: 'mint',
        inputs: [{ type: 'address' }, { type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'mint',
    args: [sponsor2.account.address, parseUnits('10', 6)],
  }),
});
let secondTx: `0x${string}` = '0x';
for (const tx of draftC.draft.transactions) {
  secondTx = await sponsor2.sendTransaction({ to: tx.to, data: tx.data });
  await sponsor2.waitForTransactionReceipt({ hash: secondTx });
}
const { readCreated } = await import('../lib/earnkit/escrow');
const secondEscrow = readCreated(
  await sponsor2.getTransactionReceipt({ hash: secondTx }),
)!.campaign.toLowerCase();
let secondErr = '';
try {
  await confirmTx(draftC.ref, secondTx);
} catch (err) {
  secondErr = (err as Error).message;
}
check(
  secondErr.includes('second escrow') &&
    secondErr.toLowerCase().includes(secondEscrow),
  'a second deposit from another wallet is reported, naming the untracked escrow',
);
const rowCAfter = await loadCampaign(draftC.ref);
check(
  rowCAfter.state === 'live' && rowCAfter.escrow_address !== secondEscrow,
  'the second deposit does not change the tracked campaign',
);
const s2Before = await wallet.readContract({
  address: token,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [sponsor2.account.address],
});
const refundEscrowOut =
  runCampaignCli(
    'refund',
    draftC.ref,
    '--escrow',
    secondEscrow,
    '--reason',
    'no-eligible',
    '--execute',
  ) ?? '';
check(
  /refunded untracked escrow .* \(database unchanged\): 0x/.test(
    refundEscrowOut,
  ),
  '`campaign refund --escrow` refunds the untracked escrow',
);
const s2After = await wallet.readContract({
  address: token,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [sponsor2.account.address],
});
check(
  s2After - s2Before === parseUnits('10', 6),
  'the second depositor gets the full 10 USDC back',
);
check(
  (await loadCampaign(draftC.ref)).state === 'live',
  'campaign C stays live after the untracked refund',
);

// ---------------------------------------------------------------------------
// Campaign 2: an expired draft, funded late, rescued by the receipt (binding item 2).
// ---------------------------------------------------------------------------
const draft2 = await createAndFund(mkDraft('E2E expired-rescue', '10', 3.5));
await db`UPDATE sponsor_campaigns SET created_at = created_at - interval '8 days' WHERE ref = ${draft2.ref}`;
const expired = await loadCampaign(draft2.ref);
check(
  expired.state === 'expired',
  'an 8-day-old unfunded draft lazily expires',
);
const rescued = await confirmFunding(draft2.ref, draft2.fundTx);
check(
  rescued.program_id.startsWith('sponsor-'),
  'a valid receipt rescues an expired draft to live',
);
check(
  (await loadCampaign(draft2.ref)).state === 'live',
  "the rescued campaign's DB row is live",
);

// ---------------------------------------------------------------------------
// Item 2: a draft whose deadline is under 10 minutes away can't be funded: it lazily expires,
// and status says the deadline has passed.
// ---------------------------------------------------------------------------
const late = await createSponsorDraft(
  mkDraft('E2E late draft', '5', 3.5),
  inst,
);
await db`UPDATE sponsor_campaigns SET draft = jsonb_set(draft, '{ends_at}', to_jsonb(${new Date(Date.now() + 5 * 60_000).toISOString()}::text)) WHERE ref = ${late.ref}`;
check(
  (await loadCampaign(late.ref)).state === 'expired',
  'a draft 5 minutes from its deadline lazily expires',
);
const lateStatus = (await tools.sponsor_campaign(
  { action: 'status', ref: late.ref },
  { installationId: inst },
)) as { state: string; show_to_sponsor: string; fund_url?: string };
check(
  lateStatus.state === 'expired' &&
    lateStatus.show_to_sponsor === DEADLINE_PASSED &&
    !lateStatus.fund_url,
  `status for it: ${JSON.stringify(lateStatus.show_to_sponsor)}`,
);
const pastDraft = await createSponsorDraft(
  mkDraft('E2E past draft', '5', 3.5),
  inst,
);
await db`UPDATE sponsor_campaigns SET draft = jsonb_set(draft, '{ends_at}', to_jsonb(${new Date(Date.now() - 60_000).toISOString()}::text)) WHERE ref = ${pastDraft.ref}`;
check(
  (await loadCampaign(pastDraft.ref)).state === 'expired',
  'a draft past its deadline lazily expires',
);

// ---------------------------------------------------------------------------
// Campaign 6: an expired, funded draft whose confirm never ran, repaired by
// `campaign sync <ref> --tx <hash>` (I-3).
// ---------------------------------------------------------------------------
const draft6 = await createAndFund(mkDraft('E2E sync-repair', '5', 3.5));
await db`UPDATE sponsor_campaigns SET created_at = created_at - interval '8 days' WHERE ref = ${draft6.ref}`;
check(
  (await loadCampaign(draft6.ref)).state === 'expired',
  'campaign 6 is an expired draft before repair',
);
const syncTxOut =
  runCampaignCli('sync', draft6.ref, '--tx', draft6.fundTx) ?? '';
check(
  /repaired: funding confirmed \(database expired -> live\)/.test(syncTxOut),
  '`campaign sync --tx` repairs the expired, funded draft',
);
check(
  /chain says: live/.test(syncTxOut),
  '`campaign sync --tx` then prints the chain state',
);
const row6 = await loadCampaign(draft6.ref);
check(
  row6.state === 'live' && row6.fund_tx === draft6.fundTx,
  "campaign 6's DB row is live with its fund_tx",
);

// ---------------------------------------------------------------------------
// Campaign 3: off-plan award — the sponsor calls the escrow directly, bypassing prepareAward,
// with one entry's wallet and one wallet that isn't an entry (binding item 3).
// ---------------------------------------------------------------------------
const entryWallet = '0x00000000000000000000000000000000000000c3';
const nonEntryWallet = '0x00000000000000000000000000000000000000d4';
const draft3 = await createAndFund(mkDraft('E2E off-plan award', '40', 3.5));
const live3 = await confirmFunding(draft3.ref, draft3.fundTx);
const gamma = await recordSubmission(
  {
    program_id: live3.program_id,
    project: {
      name: 'Gamma',
      repo_url: 'https://github.com/x/c',
      live_url: 'https://c.app',
    },
    submission_data: { payout_wallet: entryWallet },
  },
  inst,
);

// Campaigns 4 and 5's createCampaign calls must land before the chain is warped forward (their
// on-chain endsAt is only ~3.5 real-world days out, same as campaign 3's); fund them now and
// confirm/use them further down, once the chain has moved past their deadlines too.
const draft4 = await createAndFund(mkDraft('E2E operator-refund', '15', 3.5));
const draft5 = await createAndFund(mkDraft('E2E operator-award', '20', 3.5));
const draft7 = await createAndFund(
  mkDraft('E2E no-eligible refund', '12', 3.5),
);

// Entries for the status checks (item 4): one in campaign A that won't be picked, one in
// campaign C that stays live.
const eps = await recordSubmission(
  {
    program_id: live.program_id,
    project: {
      name: 'Epsilon',
      repo_url: 'https://github.com/x/e',
      live_url: 'https://e.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000e1',
    },
  },
  inst,
);
const theta = await recordSubmission(
  {
    program_id: c1.program_id,
    project: { name: 'Theta', repo_url: 'https://github.com/x/t' },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000e2',
    },
  },
  inst,
);

// Warp past campaign A's and campaign 3's end dates (both ~3.5-4 days out) and reset campaign
// A's stored ends_at to the real past, the same way a sponsor's deadline actually arrives.
await warpDays(6);
await db`UPDATE sponsor_campaigns SET draft = jsonb_set(draft, '{ends_at}', to_jsonb(${new Date(Date.now() - 1000).toISOString()}::text)) WHERE ref = ${draft.ref}`;

const { campaignAbi } = await import('../lib/earnkit/escrow-abi');
const row3 = await loadCampaign(draft3.ref);
const escrow3 = row3.escrow_address as `0x${string}`;
const offPlanHash = await wallet.writeContract({
  address: escrow3,
  abi: campaignAbi,
  functionName: 'award',
  args: [
    [entryWallet, nonEntryWallet],
    [parseUnits('20', 6), parseUnits('16', 6)],
  ],
});
await wallet.waitForTransactionReceipt({ hash: offPlanHash });
const offPlanResult = await confirmAward(draft3.ref, offPlanHash);
check(offPlanResult.paid === 1, "off-plan award records the entry's prize");
check(offPlanResult.flagged === 1, 'off-plan award flags the non-entry wallet');
const [gammaRow] = await db<
  { prize_amount: string }[]
>`SELECT prize_amount FROM projects WHERE id = ${gamma.project_id}`;
check(gammaRow.prize_amount === '20', "Gamma's prize is recorded as 20");
const [offPlanRow] = await db<
  {
    award_onchain: {
      wallet: string;
      amount: string;
      entry_id: number | null;
    }[];
  }[]
>`SELECT award_onchain FROM sponsor_campaigns WHERE ref = ${draft3.ref}`;
const flaggedWallet = offPlanRow.award_onchain.find(
  (o) => o.wallet.toLowerCase() === nonEntryWallet.toLowerCase(),
);
check(
  flaggedWallet?.entry_id === null,
  'award_onchain flags the non-entry wallet with entry_id: null',
);

let afterAwardFails = false;
try {
  await prepareAward(draft3.ref, inst, [
    { entry_id: gamma.project_id, amount: '1', reason: 'x' },
  ]);
} catch {
  afterAwardFails = true;
}
check(
  afterAwardFails,
  'prepareAward refuses an already-awarded campaign (binding item 4)',
);

// ---------------------------------------------------------------------------
// Campaign A's own award, via prepareAward/confirmAward (the sponsor-signed happy path).
// ---------------------------------------------------------------------------
const award = await prepareAward(draft.ref, inst, [
  { entry_id: a.project_id, amount: '60', reason: 'Works best' },
  { entry_id: b.project_id, amount: '30', reason: 'Runner-up' },
]);
check(
  award.show_to_sponsor ===
    'Award ready:\n' +
      `- Alpha (entry #${a.project_id}): 60 USDC — Works best\n` +
      `- Beta (entry #${b.project_id}): 30 USDC — Runner-up\n` +
      "EarnKit's 10% (10 USDC) is released with this payout.\n" +
      `Sign it here: ${award.award_url}` &&
    award.next_step.includes(award.award_url),
  'award replies with each winner by project name, the fee, award_url and next_step',
);
const names = await entryNames([a.project_id, b.project_id]);
check(
  names.get(a.project_id) === 'Alpha' && names.get(b.project_id) === 'Beta',
  'the award page can name each winner',
);
const afterDeadline = (await tools.sponsor_campaign(
  { action: 'status', ref: draft.ref },
  { installationId: inst },
)) as { next_step?: string };
check(
  afterDeadline.next_step?.includes(award.award_url) === true,
  'status after the deadline with a prepared award points at award_url',
);
const awardHash = await wallet.sendTransaction({
  to: award.transaction.to,
  data: award.transaction.data,
});
await wallet.waitForTransactionReceipt({ hash: awardHash });
check(
  (await confirmAward(draft.ref, awardHash)).paid === 2,
  'award confirmed for 2 winners',
);
const bal = await wallet.readContract({
  address: token,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: ['0x00000000000000000000000000000000000000a1'],
});
check(bal === parseUnits('60', 6), 'winner A received 60 USDC');
const treasuryBal = await wallet.readContract({
  address: token,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [treasury as `0x${string}`],
});
// Campaign 3's off-plan award already paid its own 4 USDC fee to the treasury above, so by now
// the treasury holds campaign 3's fee (4) plus campaign A's (10).
check(
  treasuryBal === parseUnits('14', 6),
  "EarnKit's 10% fees (4 + 10 USDC) reached the treasury",
);

let afterAwardFailsAgain = false;
try {
  await prepareAward(draft.ref, inst, [
    { entry_id: a.project_id, amount: '1', reason: 'x' },
  ]);
} catch {
  afterAwardFailsAgain = true;
}
check(
  afterAwardFailsAgain,
  'prepareAward refuses campaign A once it is awarded too',
);

const awardedStatus = (await tools.sponsor_campaign(
  { action: 'status', ref: draft.ref },
  { installationId: inst },
)) as { show_to_sponsor: string };
check(
  awardedStatus.show_to_sponsor.startsWith(
    'E2E campaign is awarded: 2 winners paid.',
  ),
  `status (awarded): ${JSON.stringify(awardedStatus.show_to_sponsor)}`,
);
check(
  presentYourEntries(await yourCampaignEntries(inst), null).wins.includes(
    'you won 60 USDC with Alpha',
  ),
  '"you won 60 USDC with Alpha"',
);

// ---------------------------------------------------------------------------
// Campaign 4: operator refund of a still-live campaign (binding item 5). Created earlier,
// before the chain was warped past its deadline (the deadline doesn't matter for this refund).
// ---------------------------------------------------------------------------
const live4 = await confirmFunding(draft4.ref, draft4.fundTx);
const zeta = await recordSubmission(
  {
    program_id: live4.program_id,
    project: { name: 'Zeta', repo_url: 'https://github.com/x/z' },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000e3',
    },
  },
  inst,
);
const sponsorBalBefore = await wallet.readContract({
  address: token,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [wallet.account.address],
});
const refundOut =
  runCampaignCli('refund', draft4.ref, '--reason', 'takedown', '--execute') ??
  '';
check(
  /refunded: 0x/.test(refundOut),
  '`campaign refund --execute` refunds the sponsor',
);
const sponsorBalAfter = await wallet.readContract({
  address: token,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [wallet.account.address],
});
check(
  sponsorBalAfter - sponsorBalBefore === parseUnits('15', 6),
  "the sponsor's balance increases by the full deposit on takedown refund",
);
const [row4] = await db<
  { state: string }[]
>`SELECT state FROM sponsor_campaigns WHERE ref = ${draft4.ref}`;
check(row4.state === 'taken_down', 'campaign 4 is marked taken_down');
const [prog4] = await db<{ status: string }[]>`
  SELECT pr.status FROM programs pr JOIN sponsor_campaigns sc ON sc.program_id = pr.id WHERE sc.ref = ${draft4.ref}`;
check(prog4.status === 'closed', "campaign 4's program is closed");

const syncOut = runCampaignCli('sync', draft4.ref) ?? '';
check(
  /chain says: refunded/.test(syncOut),
  '`campaign sync` prints the chain state',
);
check(
  /goes back to the sponsor 0x/i.test(refundOut),
  '`campaign refund` says who receives the money',
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
const help = execFileSync(tsxBin, [campaignScript, '--help'], {
  encoding: 'utf8',
});
check(
  ['score', 'rank', 'payout', 'award', 'refund', 'sync'].every((c) =>
    new RegExp(`\\n  ${c} +<`).test(help),
  ),
  '`campaign --help` lists all six commands',
);

// ---------------------------------------------------------------------------
// Campaign 7: operator refund because nobody qualified (no-eligible), with one entry.
// ---------------------------------------------------------------------------
const live7 = await confirmFunding(draft7.ref, draft7.fundTx);
const eta = await recordSubmission(
  {
    program_id: live7.program_id,
    project: { name: 'Eta', repo_url: 'https://github.com/x/h' },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000e4',
    },
  },
  inst,
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
// Items 3/4: statuses on the board, the entry page, and "Your campaign entries".
// ---------------------------------------------------------------------------
const boardA = (await getCampaignBoard(live.program_id))!;
const statusOf = (board: NonNullable<typeof boardA>, id: number) => {
  const r = board.rows.find((x) => x.id === id)!;
  return entryStatus(board.program.campaign, r, board.sponsorState);
};
check(
  boardA.rows.every((r) => r.score === null),
  'campaign A has no scores, so its board is a plain entry list',
);
check(
  statusOf(boardA, a.project_id) === 'won 60 USDC',
  'board: Alpha "won 60 USDC"',
);
check(
  statusOf(boardA, eps.project_id) === 'not picked',
  'board: Epsilon "not picked"',
);
const board7 = (await getCampaignBoard(live7.program_id))!;
check(
  statusOf(board7, eta.project_id) === 'no winners — sponsor refunded',
  'board: Eta "no winners — sponsor refunded"',
);
const boardC = (await getCampaignBoard(c1.program_id))!;
check(
  statusOf(boardC, theta.project_id) === 'entered',
  'board: Theta (live) "entered"',
);
check(
  (await getCampaignBoard(live4.program_id)) === null,
  'a taken-down campaign board is 404',
);
check(
  (await getProjectPage(zeta.project_id)) === null,
  'a taken-down entry page is 404',
);
const epsPage = (await getProjectPage(eps.project_id))!;
check(
  epsPage.sponsor_state === 'awarded' &&
    !epsPage.any_scored &&
    entryStatus(epsPage.campaign, epsPage, epsPage.sponsor_state) ===
      'not picked',
  'entry page: Epsilon is "not picked" with no rank (nothing scored)',
);
const yours =
  presentYourEntries(await yourCampaignEntries(inst), null).section ?? '';
console.log(
  yours
    .split('\n')
    .map((l) => `  | ${l}`)
    .join('\n'),
);
const lineFor = (name: string) =>
  yours
    .split('\n')
    .find((l) => l.startsWith(`${name} `) || l.startsWith(`${name}:`)) ?? '';
check(
  lineFor('Epsilon') === 'Epsilon in E2E campaign: not picked this time',
  'your entries: Epsilon "not picked this time"',
);
check(
  lineFor('Eta') ===
    'Eta in E2E no-eligible refund: no winners; the sponsor was refunded',
  'your entries: Eta "no winners; the sponsor was refunded"',
);
check(
  lineFor('Zeta') ===
    'Zeta in E2E operator-refund: removed by EarnKit; the sponsor was refunded',
  'your entries: Zeta "removed by EarnKit; the sponsor was refunded"',
);
check(
  /^Theta in E2E concurrent-confirm: entered · winners picked after [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2} UTC$/.test(
    lineFor('Theta'),
  ),
  'your entries: Theta "entered · winners picked after <date>"',
);
check(!/#\d+ of \d+/.test(yours), 'no "#N of M" for unscored sponsor entries');
check(racer.value.project_id > 0, 'the racing entry is listed too');

// Item 11: Campaign #1 (EarnKit kind, closed, no entries) has no public page.
const [c1prog] = await db<
  { status: string }[]
>`SELECT status FROM programs WHERE id = 'earnkit-campaign-1-base'`;
if (c1prog) {
  check(
    (await getCampaignBoard('earnkit-campaign-1-base')) === null,
    'Campaign #1 (closed, no entries) is 404',
  );
} else
  console.log('skip: earnkit-campaign-1-base not synced into this database');

// ---------------------------------------------------------------------------
// Campaign 5: operator fallback award, after endsAt + the 7-day grace (binding item 5). Also
// created earlier, before the chain was warped.
// ---------------------------------------------------------------------------
const live5 = await confirmFunding(draft5.ref, draft5.fundTx);
const delta = await recordSubmission(
  {
    program_id: live5.program_id,
    project: {
      name: 'Delta',
      repo_url: 'https://github.com/x/d',
      live_url: 'https://d.app',
    },
    submission_data: {
      payout_wallet: '0x00000000000000000000000000000000000000e5',
    },
  },
  inst,
);
// Campaign 5's on-chain endsAt is ~3.5 days from its creation (chain time was still ~day 0 then);
// the operator needs endsAt + 7 days. The chain is already 6 days in; 8 more clears it with room.
const tooEarly = runCampaignCliFails(
  {},
  'award',
  draft5.ref,
  '--winners',
  `${delta.project_id}:18:Too early`,
  '--execute',
);
check(
  /^The fallback opens on [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2} UTC\.$/.test(
    tooEarly.stderr,
  ),
  `the operator award before endsAt + 7 days is refused: ${tooEarly.stderr}`,
);
await warpDays(8);
const awardOut =
  runCampaignCli(
    'award',
    draft5.ref,
    '--winners',
    `${delta.project_id}:18:Operator fallback award`,
    '--execute',
  ) ?? '';
check(
  /awarded: 0x/.test(awardOut),
  '`campaign award --execute` pays the operator fallback',
);
const [row5] = await db<
  { state: string }[]
>`SELECT state FROM sponsor_campaigns WHERE ref = ${draft5.ref}`;
check(
  row5.state === 'awarded',
  'campaign 5 is marked awarded by the operator fallback',
);
const [deltaRow] = await db<
  { prize_amount: string }[]
>`SELECT prize_amount FROM projects WHERE id = ${delta.project_id}`;
check(deltaRow.prize_amount === '18', "Delta's prize (18 USDC) is recorded");

await db.end();
console.log('E2E PASSED');
