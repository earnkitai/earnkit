import './env.mts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWalletClient, erc20Abi, http, parseUnits, publicActions } from 'viem';
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
  guardFail(`DATABASE_URL is missing or not a valid URL (got ${JSON.stringify(guardDbUrl)}).`);
}
if (guardDbHost !== 'localhost' && guardDbHost !== '127.0.0.1') {
  guardFail(`DATABASE_URL must point at localhost or 127.0.0.1 (got host ${JSON.stringify(guardDbHost)}).`);
}
const guardRpcUrl = process.env.ESCROW_RPC_URL;
if (!guardRpcUrl) guardFail('ESCROW_RPC_URL is not set.');
const guardChainId: number = await fetch(guardRpcUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
})
  .then((r) => r.json())
  .then((j) => Number(j.result))
  .catch((err) => guardFail(`Could not reach ESCROW_RPC_URL (${guardRpcUrl}): ${err}`));
if (guardChainId !== 31337) {
  guardFail(`ESCROW_RPC_URL must be a local anvil (chain id 31337); it reported ${guardChainId}.`);
}

const RPC = guardRpcUrl;
const sponsorKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // anvil #1
const operatorKey = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'; // anvil #2 (OPERATOR at deploy)
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
} = await import('../lib/earnkit/sponsor');
const { recordSubmission } = await import('../lib/earnkit/projects');
const { presentYourEntries } = await import('../lib/earnkit/campaigns');
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
const tsxBin = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const campaignScript = fileURLToPath(new URL('campaign.mts', import.meta.url));
function runCampaignCli(...args: string[]) {
  try {
    return execFileSync(tsxBin, [campaignScript, ...args], {
      env: { ...process.env, OPERATOR_PRIVATE_KEY: operatorKey },
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    fail(`campaign ${args.join(' ')} failed: ${e.stderr || e.stdout || e.message}`);
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
function mkDraft(title: string, amount: string, endsInDays: number, winners = 1): Draft {
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
const draft = await createSponsorDraft(mkDraft('E2E campaign', '100', 4, 2), inst);
check(draft.transactions.length === 2, 'draft returns approve + createCampaign');

let fundTx: `0x${string}` = '0x';
for (const tx of draft.transactions) {
  fundTx = await wallet.sendTransaction({ to: tx.to, data: tx.data });
  await wallet.waitForTransactionReceipt({ hash: fundTx });
}
const live = await confirmFunding(draft.ref, fundTx);
check(live.program_id.startsWith('sponsor-'), 'funding confirmed, program live');
check(
  (await confirmFunding(draft.ref, fundTx)).program_id === live.program_id,
  'confirm twice is idempotent',
);

const approveTx = await wallet.sendTransaction({ to: draft.transactions[0].to, data: draft.transactions[0].data });
const approveReceipt = await wallet.waitForTransactionReceipt({ hash: approveTx });
let rejected = false;
try {
  fundingFromReceipt(
    { ref: draft.ref, token, token_decimals: 6, amount: '100', draft: { ends_at: endsA } },
    approveReceipt,
  );
} catch {
  rejected = true;
}
check(rejected, 'a non-funding tx is rejected');

const a = await recordSubmission(
  {
    program_id: live.program_id,
    project: { name: 'Alpha', repo_url: 'https://github.com/x/a', live_url: 'https://a.app' },
    submission_data: { payout_wallet: '0x00000000000000000000000000000000000000a1' },
  },
  inst,
);
const b = await recordSubmission(
  {
    program_id: live.program_id,
    project: { name: 'Beta', repo_url: 'https://github.com/x/b', live_url: 'https://b.app' },
    submission_data: { payout_wallet: '0x00000000000000000000000000000000000000b2' },
  },
  inst,
);
check((await sponsorStatus(draft.ref, inst)).entries.length === 2, 'two entries without contracts');

let early = false;
try {
  await prepareAward(draft.ref, inst, [{ entry_id: a.project_id, amount: '90', reason: 'Works best' }]);
} catch {
  early = true;
}
check(early, 'award refused before the end');

// ---------------------------------------------------------------------------
// Campaign C: two concurrent confirmFunding(ref, tx) calls for the same ref (binding item 1).
// ---------------------------------------------------------------------------
const draftC = await createAndFund(mkDraft('E2E concurrent-confirm', '10', 3.5));
const [c1, c2] = await Promise.all([
  confirmFunding(draftC.ref, draftC.fundTx),
  confirmFunding(draftC.ref, draftC.fundTx),
]);
check(c1.program_id === c2.program_id, 'two concurrent confirms return the same program_id');
const [{ n: programRows }] = await db<{ n: string }[]>`
  SELECT count(*)::text AS n FROM programs WHERE id = ${c1.program_id}`;
check(Number(programRows) === 1, 'exactly one programs row exists after the concurrent confirm');

// ---------------------------------------------------------------------------
// Campaign 2: an expired draft, funded late, rescued by the receipt (binding item 2).
// ---------------------------------------------------------------------------
const draft2 = await createAndFund(mkDraft('E2E expired-rescue', '10', 3.5));
await db`UPDATE sponsor_campaigns SET created_at = created_at - interval '8 days' WHERE ref = ${draft2.ref}`;
const expired = await loadCampaign(draft2.ref);
check(expired.state === 'expired', 'an 8-day-old unfunded draft lazily expires');
const rescued = await confirmFunding(draft2.ref, draft2.fundTx);
check(rescued.program_id.startsWith('sponsor-'), 'a valid receipt rescues an expired draft to live');
check((await loadCampaign(draft2.ref)).state === 'live', "the rescued campaign's DB row is live");

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
    project: { name: 'Gamma', repo_url: 'https://github.com/x/c', live_url: 'https://c.app' },
    submission_data: { payout_wallet: entryWallet },
  },
  inst,
);

// Campaigns 4 and 5's createCampaign calls must land before the chain is warped forward (their
// on-chain endsAt is only ~3.5 real-world days out, same as campaign 3's); fund them now and
// confirm/use them further down, once the chain has moved past their deadlines too.
const draft4 = await createAndFund(mkDraft('E2E operator-refund', '15', 3.5));
const draft5 = await createAndFund(mkDraft('E2E operator-award', '20', 3.5));

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
  args: [[entryWallet, nonEntryWallet], [parseUnits('20', 6), parseUnits('16', 6)]],
});
await wallet.waitForTransactionReceipt({ hash: offPlanHash });
const offPlanResult = await confirmAward(draft3.ref, offPlanHash);
check(offPlanResult.paid === 1, "off-plan award records the entry's prize");
check(offPlanResult.flagged === 1, 'off-plan award flags the non-entry wallet');
const [gammaRow] = await db<{ prize_amount: string }[]>`SELECT prize_amount FROM projects WHERE id = ${gamma.project_id}`;
check(gammaRow.prize_amount === '20', "Gamma's prize is recorded as 20");
const [offPlanRow] = await db<
  { award_onchain: { wallet: string; amount: string; entry_id: number | null }[] }[]
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
  await prepareAward(draft3.ref, inst, [{ entry_id: gamma.project_id, amount: '1', reason: 'x' }]);
} catch {
  afterAwardFails = true;
}
check(afterAwardFails, 'prepareAward refuses an already-awarded campaign (binding item 4)');

// ---------------------------------------------------------------------------
// Campaign A's own award, via prepareAward/confirmAward (the sponsor-signed happy path).
// ---------------------------------------------------------------------------
const award = await prepareAward(draft.ref, inst, [
  { entry_id: a.project_id, amount: '60', reason: 'Works best' },
  { entry_id: b.project_id, amount: '30', reason: 'Runner-up' },
]);
const awardHash = await wallet.sendTransaction({ to: award.transaction.to, data: award.transaction.data });
await wallet.waitForTransactionReceipt({ hash: awardHash });
check((await confirmAward(draft.ref, awardHash)).paid === 2, 'award confirmed for 2 winners');
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
check(treasuryBal === parseUnits('14', 6), "EarnKit's 10% fees (4 + 10 USDC) reached the treasury");

let afterAwardFailsAgain = false;
try {
  await prepareAward(draft.ref, inst, [{ entry_id: a.project_id, amount: '1', reason: 'x' }]);
} catch {
  afterAwardFailsAgain = true;
}
check(afterAwardFailsAgain, 'prepareAward refuses campaign A once it is awarded too');

const [won] = await db<
  {
    name: string;
    campaign_title: string;
    campaign: never;
    score: null;
    rank: number;
    entries: number;
    prize_tx: string;
    prize_paid_at: Date;
    prize_amount: string;
  }[]
>`
  SELECT p.name, pr.title AS campaign_title, pr.campaign, p.score, 1 AS rank, 2 AS entries, p.prize_tx, p.prize_paid_at, p.prize_amount
  FROM projects p JOIN programs pr ON pr.id = p.program_id WHERE p.id = ${a.project_id}`;
check(
  presentYourEntries([won], null).wins[0] === 'you won 60 USDC with Alpha',
  '"you won 60 USDC with Alpha"',
);

// ---------------------------------------------------------------------------
// Campaign 4: operator refund of a still-live campaign (binding item 5). Created earlier,
// before the chain was warped past its deadline (the deadline doesn't matter for this refund).
// ---------------------------------------------------------------------------
await confirmFunding(draft4.ref, draft4.fundTx);
const sponsorBalBefore = await wallet.readContract({
  address: token,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [wallet.account.address],
});
const refundOut = runCampaignCli('refund', draft4.ref, '--reason', 'takedown', '--execute') ?? '';
check(/refunded: 0x/.test(refundOut), '`campaign refund --execute` refunds the sponsor');
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
const [row4] = await db<{ state: string }[]>`SELECT state FROM sponsor_campaigns WHERE ref = ${draft4.ref}`;
check(row4.state === 'taken_down', 'campaign 4 is marked taken_down');
const [prog4] = await db<{ status: string }[]>`
  SELECT pr.status FROM programs pr JOIN sponsor_campaigns sc ON sc.program_id = pr.id WHERE sc.ref = ${draft4.ref}`;
check(prog4.status === 'closed', "campaign 4's program is closed");

const syncOut = runCampaignCli('sync', draft4.ref) ?? '';
check(/chain says: refunded/.test(syncOut), '`campaign sync` prints the chain state');

// ---------------------------------------------------------------------------
// Campaign 5: operator fallback award, after endsAt + the 7-day grace (binding item 5). Also
// created earlier, before the chain was warped.
// ---------------------------------------------------------------------------
const live5 = await confirmFunding(draft5.ref, draft5.fundTx);
const delta = await recordSubmission(
  {
    program_id: live5.program_id,
    project: { name: 'Delta', repo_url: 'https://github.com/x/d', live_url: 'https://d.app' },
    submission_data: { payout_wallet: '0x00000000000000000000000000000000000000e5' },
  },
  inst,
);
// Campaign 5's on-chain endsAt is ~3.5 days from its creation (chain time was still ~day 0 then);
// the operator needs endsAt + 7 days. The chain is already 6 days in; 8 more clears it with room.
await warpDays(8);
const awardOut =
  runCampaignCli(
    'award',
    draft5.ref,
    '--winners',
    `${delta.project_id}:18:Operator fallback award`,
    '--execute',
  ) ?? '';
check(/awarded: 0x/.test(awardOut), '`campaign award --execute` pays the operator fallback');
const [row5] = await db<{ state: string }[]>`SELECT state FROM sponsor_campaigns WHERE ref = ${draft5.ref}`;
check(row5.state === 'awarded', 'campaign 5 is marked awarded by the operator fallback');
const [deltaRow] = await db<{ prize_amount: string }[]>`SELECT prize_amount FROM projects WHERE id = ${delta.project_id}`;
check(deltaRow.prize_amount === '18', "Delta's prize (18 USDC) is recorded");

await db.end();
console.log('E2E PASSED');
