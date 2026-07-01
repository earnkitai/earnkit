/**
 * One-shot: trigger a shared-split buyback "check" (the dashboard "Trigger
 * buyback now" button) from the command line.
 *
 * It reproduces exactly what apps/dashboard/lib/buybackAuth.ts:signBuybackAction
 * does for a { kind: 'check' } action, then POSTs to
 *   POST {BACKEND}/api/shared-buyback/:configId/check
 * The route is owner-signature-gated (requireBuybackAuth) — NOT the internal
 * secret. So the signer must control the config's ownerAddress (an EOA, or a
 * Safe owner if ownerAddress is a Safe).
 *
 * All secrets via env (never commit a key):
 *   EARNKIT_BACKEND_URL   e.g. https://<railway-url>  (no trailing slash)
 *   CONFIG_ID             the SharedSplitBuybackConfig.id
 *   OWNER_PRIVATE_KEY     0x-prefixed private key that controls the owner
 *   OWNER_ADDRESS         optional — the config's ownerAddress. Defaults to the
 *                         signer's own address. REQUIRED if the owner is a Safe
 *                         (set it to the Safe address; sign with a Safe owner key).
 *
 * Run:
 *   EARNKIT_BACKEND_URL=... CONFIG_ID=... OWNER_PRIVATE_KEY=0x... \
 *     pnpm --filter earn-backend exec tsx src/scripts/triggerSharedBuyback.ts
 */
import { getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const backend = requireEnv('EARNKIT_BACKEND_URL').replace(/\/$/, '');
  const configId = requireEnv('CONFIG_ID');
  const privateKey = requireEnv('OWNER_PRIVATE_KEY') as Hex;

  const account = privateKeyToAccount(privateKey);
  // Owner must match the config's ownerAddress (checksummed). Defaults to the
  // signer address for the common EOA-owner case.
  const owner = getAddress(process.env.OWNER_ADDRESS ?? account.address);

  const signedAt = new Date().toISOString();
  // Must byte-for-byte match buildAuthMessage(..., { kind: 'check', configId }).
  const message = [
    'EarnKit Shared Buyback',
    `owner: ${owner}`,
    `signedAt: ${signedAt}`,
    'action: check',
    `config: ${configId}`,
  ].join('\n');

  const signature = await account.signMessage({ message });

  console.log('Signing as:', account.address);
  console.log('owner (must equal config.ownerAddress):', owner);
  console.log('POST', `${backend}/api/shared-buyback/${configId}/check`);

  const res = await fetch(`${backend}/api/shared-buyback/${configId}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature, signedAt }),
  });

  const text = await res.text();
  console.log('HTTP', res.status);
  console.log(text);

  // { queued: true, executionId, triggerBalanceUsd } on success;
  // { queued: false, reason: 'below_threshold' | 'execution_in_flight' } otherwise.
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
