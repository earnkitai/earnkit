/**
 * Raise EXISTING buyback sub-orgs from a 1-of-N root quorum to 2-of-N.
 *
 * WHY: sub-orgs were provisioned with `rootQuorumThreshold: 1` and the
 * platform-parent-admin as a ROOT user. Root-quorum members are NOT bound by
 * policies, so a single stamp from the Railway parent-admin key could authorize
 * ANY signature (drain to any address) or alter the quorum/policy — the co-signer
 * and the 2-stamper policy were effectively bypassed. New wallets are now created
 * with threshold 2 (see createBuybackSubOrgWallet); this script fixes existing ones.
 *
 * After threshold 2, the backend's single parent-admin stamp no longer meets
 * quorum, so every signing/root activity requires the off-host co-signer (which
 * validates the operation shape). Raising the threshold FROM 1 needs only the
 * current single stamp, so the backend can perform this migration itself.
 *
 * Safe by construction: keeps the SAME user set, only raises the threshold. It
 * never lowers a quorum (skips any sub-org already at threshold >= 2).
 *
 * Usage (run INSIDE the Railway backend container):
 *   railway run tsx src/scripts/raiseRootQuorum.ts             # dry run — lists what it would change
 *   APPLY=1 railway run tsx src/scripts/raiseRootQuorum.ts     # apply
 *   CONFIG_ID=<id> APPLY=1 railway run tsx src/scripts/raiseRootQuorum.ts   # single config (e.g. MINI first)
 */
import { prisma } from '../lib/prisma';
import { getSubOrgUsers, setRootQuorum } from '../services/turnkeyService';

const TARGET_THRESHOLD = 2;

async function collectSubOrgs(): Promise<Array<{ label: string; subOrgId: string }>> {
  const only = process.env.CONFIG_ID;
  const out: Array<{ label: string; subOrgId: string }> = [];

  if (only) {
    const shared = await prisma.sharedSplitBuybackConfig.findUnique({ where: { id: only } });
    if (shared?.turnkeySubOrgId) out.push({ label: `shared:${shared.id}`, subOrgId: shared.turnkeySubOrgId });
    const agent = await prisma.buybackConfig.findUnique({ where: { id: only } });
    if (agent?.turnkeySubOrgId) out.push({ label: `agent:${agent.id}`, subOrgId: agent.turnkeySubOrgId });
    return out;
  }

  const sharedConfigs = await prisma.sharedSplitBuybackConfig.findMany({
    where: { turnkeySubOrgId: { not: null } },
    select: { id: true, turnkeySubOrgId: true },
  });
  for (const c of sharedConfigs) out.push({ label: `shared:${c.id}`, subOrgId: c.turnkeySubOrgId! });

  const agentConfigs = await prisma.buybackConfig.findMany({
    select: { id: true, turnkeySubOrgId: true },
  });
  for (const c of agentConfigs) {
    if (c.turnkeySubOrgId) out.push({ label: `agent:${c.id}`, subOrgId: c.turnkeySubOrgId });
  }

  return out;
}

async function main(): Promise<void> {
  const apply = process.env.APPLY === '1' || process.env.DRY_RUN === 'false';
  const subOrgs = await collectSubOrgs();

  // De-dup sub-orgs (a sub-org maps to exactly one config, but be safe).
  const seen = new Set<string>();
  const unique = subOrgs.filter((s) => (seen.has(s.subOrgId) ? false : (seen.add(s.subOrgId), true)));

  console.log(`=== Raise root quorum to ${TARGET_THRESHOLD}-of-N ===`);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY RUN'} — ${unique.length} sub-org(s)\n`);

  let changed = 0;
  let skipped = 0;
  let failed = 0;

  for (const { label, subOrgId } of unique) {
    try {
      const users = await getSubOrgUsers(subOrgId);
      const userIds = users.map((u) => u.userId);
      if (userIds.length < TARGET_THRESHOLD) {
        console.warn(`SKIP ${label} (${subOrgId}): only ${userIds.length} users, cannot reach threshold ${TARGET_THRESHOLD}`);
        skipped++;
        continue;
      }
      console.log(
        `${apply ? 'SET ' : 'WOULD SET'} ${label} (${subOrgId}) -> threshold ${TARGET_THRESHOLD} over ${userIds.length} users [${users.map((u) => u.userName).join(', ')}]`,
      );
      if (apply) {
        await setRootQuorum(subOrgId, TARGET_THRESHOLD, userIds);
        changed++;
      }
    } catch (err) {
      failed++;
      console.error(`FAIL ${label} (${subOrgId}):`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone. ${apply ? `changed=${changed} ` : ''}skipped=${skipped} failed=${failed}`);
  if (!apply) console.log('Re-run with APPLY=1 to apply. Recommend CONFIG_ID=<MINI> first.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('raiseRootQuorum failed:', err);
    process.exit(1);
  });
