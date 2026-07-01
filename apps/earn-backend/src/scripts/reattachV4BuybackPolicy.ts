/**
 * Re-attach the tightened buyback policy to an EXISTING V4 sub-org wallet.
 *
 * WHY: the V4 Turnkey policy's Permit2.approve condition previously did not pin
 * the spender argument, so it authorized `Permit2.approve(token, ANY_SPENDER,
 * max, expiry)` — a compromised worker could approve an attacker as a Permit2
 * spender and drain the wallet's ERC-20s. `buildBuybackPolicy` now pins the
 * spender to the UniversalRouter, but that only affects policies created from
 * now on. Existing wallets keep their old, looser policy until it is replaced.
 *
 * This script replaces the policy on ONE config's sub-org:
 *   1. prints the CURRENT on-chain policy conditions (so you can see exactly
 *      what the wallet has today),
 *   2. builds the NEW tightened policy and prints it,
 *   3. only when APPLY=1 (or DRY_RUN=false): CREATE the new policy first, then
 *      DELETE the old one(s). Create-before-delete means the wallet is never
 *      left without a policy — worst case it briefly has both (still safe: the
 *      buyback keeps working), never neither (which would brick signing).
 *
 * Turnkey policies are additive EFFECT_ALLOW rules, so simply adding a tighter
 * policy does NOT close the hole — the old loose one must be DELETED. That is
 * why this replaces rather than appends.
 *
 * Fee authorization: the new policy includes the treasury (BUYBACK_TREASURY_ADDRESS)
 * so fee collection is authorized. Set INCLUDE_TREASURY=0 to omit it.
 *
 * Usage (run INSIDE the Railway backend container so it can reach Turnkey + DB):
 *   CONFIG_ID=<sharedSplitConfigId> railway run tsx src/scripts/reattachV4BuybackPolicy.ts           # dry run
 *   CONFIG_ID=<sharedSplitConfigId> APPLY=1 railway run tsx src/scripts/reattachV4BuybackPolicy.ts   # apply
 */
import { isAddress, getAddress } from 'viem';
import { prisma } from '../lib/prisma';
import { buildBuybackPolicy } from '../lib/turnkeyPolicy';
import {
  attachBuybackPolicy,
  getSubOrgStamperUserIds,
  listSubOrgPolicies,
  deleteSubOrgPolicy,
} from '../services/turnkeyService';

function treasuryFromEnv(): `0x${string}` | undefined {
  const addr = process.env.BUYBACK_TREASURY_ADDRESS;
  if (!addr || !isAddress(addr)) return undefined;
  return getAddress(addr) as `0x${string}`;
}

async function main(): Promise<void> {
  const configId = process.env.CONFIG_ID;
  const apply = process.env.APPLY === '1' || process.env.DRY_RUN === 'false';
  const includeTreasury = process.env.INCLUDE_TREASURY !== '0';

  if (!configId) {
    throw new Error('CONFIG_ID env var is required (the SharedSplitBuybackConfig id)');
  }

  const config = await prisma.sharedSplitBuybackConfig.findUnique({ where: { id: configId } });
  if (!config) throw new Error(`No SharedSplitBuybackConfig ${configId}`);
  if (!config.turnkeySubOrgId) throw new Error(`Config ${configId} has no turnkeySubOrgId`);
  if (!config.walletAddress) throw new Error(`Config ${configId} has no walletAddress`);

  const subOrgId = config.turnkeySubOrgId;
  const venue = (config.swapVenue as 'UNISWAP_V3' | 'UNISWAP_V4') ?? 'UNISWAP_V3';

  console.log('=== Re-attach buyback policy ===');
  console.log(`config:        ${config.id} (${config.tokenSymbol})`);
  console.log(`wallet:        ${config.walletAddress}`);
  console.log(`subOrg:        ${subOrgId}`);
  console.log(`swapVenue:     ${venue}`);
  console.log(`mode:          ${apply ? 'APPLY (will mutate)' : 'DRY RUN (no changes)'}`);

  if (venue !== 'UNISWAP_V4') {
    console.warn(
      '\n⚠️  This config is NOT UNISWAP_V4. The Permit2-spender fix only affects V4 policies; ' +
        'a V3 config does not have that condition. Proceeding will still rebuild the policy, ' +
        'but there is nothing to fix here. Aborting to be safe.',
    );
    return;
  }

  // Resolve the two stamper user IDs (prefer stored, else query Turnkey).
  let parentAdminUserId = config.parentAdminUserId ?? undefined;
  let coSignerUserId = config.coSignerUserId ?? undefined;
  if (!parentAdminUserId || !coSignerUserId) {
    const ids = await getSubOrgStamperUserIds(subOrgId);
    parentAdminUserId = ids.parentAdminUserId;
    coSignerUserId = ids.coSignerUserId;
  }

  const treasuryAddress = includeTreasury ? treasuryFromEnv() : undefined;
  console.log(
    `treasury:      ${treasuryAddress ?? '(omitted — fee transfers will NOT be authorized)'}`,
  );

  // 1. Current on-chain policies.
  const current = await listSubOrgPolicies(subOrgId);
  console.log(`\n--- CURRENT policies on sub-org (${current.length}) ---`);
  for (const p of current) {
    console.log(`\n[${p.policyName}] id=${p.policyId}`);
    console.log(`  consensus: ${p.consensus}`);
    console.log(`  condition: ${p.condition}`);
  }
  const oldBuybackPolicies = current.filter((p) => p.policyName.startsWith('buyback_'));
  if (oldBuybackPolicies.length === 0) {
    console.warn('\n⚠️  No existing policy whose name starts with "buyback_" — will only CREATE.');
  }

  // 2. Build the NEW tightened policy (fresh unique name to avoid label clash).
  const newPolicy = buildBuybackPolicy({
    userTokenAddress: config.tokenAddress as `0x${string}`,
    recoveryAddress: config.recoveryAddress as `0x${string}`,
    treasuryAddress,
    swapVenue: venue,
    parentAdminUserId,
    coSignerUserId,
  });
  const versionedName = `${newPolicy.policyName}_v2`;
  console.log(`\n--- NEW policy [${versionedName}] ---`);
  console.log(`  consensus: ${newPolicy.consensus}`);
  console.log(`  condition: ${newPolicy.condition}`);

  if (!apply) {
    console.log(
      '\nDRY RUN complete. Review the CURRENT vs NEW conditions above. ' +
        'Re-run with APPLY=1 to create the new policy and delete the old one(s).',
    );
    return;
  }

  // 3a. CREATE the new policy FIRST (wallet is over-permissive only briefly).
  console.log('\nCreating new policy...');
  const { policyId: newPolicyId } = await attachBuybackPolicy({
    subOrgId,
    parentAdminUserId,
    coSignerUserId,
    policyName: versionedName,
    policyParams: {
      userTokenAddress: config.tokenAddress as `0x${string}`,
      recoveryAddress: config.recoveryAddress as `0x${string}`,
      treasuryAddress,
      swapVenue: venue,
    },
  });
  console.log(`  created policyId=${newPolicyId}`);

  // 3b. Persist the new policyId BEFORE deleting the old, so we never lose the
  // reference to the live policy.
  await prisma.sharedSplitBuybackConfig.update({
    where: { id: config.id },
    data: { policyId: newPolicyId },
  });

  // 3c. DELETE the old loose policy/policies.
  for (const old of oldBuybackPolicies) {
    if (old.policyId === newPolicyId) continue;
    console.log(`Deleting old policy [${old.policyName}] id=${old.policyId} ...`);
    await deleteSubOrgPolicy(subOrgId, old.policyId);
    console.log('  deleted');
  }

  console.log('\n✅ Done. The wallet now enforces the tightened (Permit2-spender-pinned) policy.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('reattachV4BuybackPolicy failed:', err);
    process.exit(1);
  });
