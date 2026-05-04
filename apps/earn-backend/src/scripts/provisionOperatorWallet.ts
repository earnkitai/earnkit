/**
 * One-time provisioning script for the operator gas wallet.
 *
 * Creates a Turnkey sub-org named "earnkit-operator-gas", with a single wallet
 * inside it and a two-stamper policy permitting only "send ETH" calls (no
 * contract data). The Cloudflare Worker further restricts the destination to
 * known buyback wallets — see apps/buyback-cosigner/src/index.ts.
 *
 * Run:
 *   pnpm --filter earn-backend exec tsx src/scripts/provisionOperatorWallet.ts
 *
 * Required env (same as the buyback flow):
 *   TURNKEY_API_PUBLIC_KEY
 *   TURNKEY_API_PRIVATE_KEY
 *   TURNKEY_PARENT_ORG_ID
 *   TURNKEY_PARENT_ADMIN_USER_ID
 *   TURNKEY_COSIGNER_USER_ID
 *
 * After it prints the new sub-org id and wallet address, set on Railway:
 *   OPERATOR_TURNKEY_SUB_ORG_ID=<printed value>
 *   OPERATOR_WALLET_ADDRESS=<printed value>
 *
 * Then fund the wallet with ~0.005 ETH on Base. That covers ~5000 gas drips.
 */

import { Turnkey } from '@turnkey/sdk-server';
import { toFunctionSelector } from 'viem';
import 'dotenv/config';

async function main() {
  const apiPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey = process.env.TURNKEY_API_PRIVATE_KEY;
  const parentOrgId = process.env.TURNKEY_PARENT_ORG_ID;
  const parentAdminUserId = process.env.TURNKEY_PARENT_ADMIN_USER_ID;
  const coSignerUserId = process.env.TURNKEY_COSIGNER_USER_ID;
  const baseUrl = process.env.TURNKEY_API_BASE_URL || 'https://api.turnkey.com';

  for (const [k, v] of Object.entries({
    TURNKEY_API_PUBLIC_KEY: apiPublicKey,
    TURNKEY_API_PRIVATE_KEY: apiPrivateKey,
    TURNKEY_PARENT_ORG_ID: parentOrgId,
    TURNKEY_PARENT_ADMIN_USER_ID: parentAdminUserId,
    TURNKEY_COSIGNER_USER_ID: coSignerUserId,
  })) {
    if (!v) {
      console.error(`Missing env: ${k}`);
      process.exit(1);
    }
  }

  const turnkey = new Turnkey({
    apiBaseUrl: baseUrl,
    apiPublicKey: apiPublicKey!,
    apiPrivateKey: apiPrivateKey!,
    defaultOrganizationId: parentOrgId!,
  });
  const client = turnkey.apiClient();

  const subOrgName = `earnkit-operator-gas-${Date.now().toString(36)}`;
  console.log(`Creating sub-org: ${subOrgName}`);

  // Operator sub-org has no human root user — it's purely operated by the
  // parent-org users (admin + co-signer). We still need one root user record;
  // we mark it as an "ops" placeholder with no credentials. Recovery (if ever
  // needed) is via parent-org admin.
  const createResp = await client.createSubOrganization({
    subOrganizationName: subOrgName,
    rootUsers: [
      {
        userName: 'ops-placeholder',
        authenticators: [],
        apiKeys: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: {
      walletName: 'operator-gas',
      accounts: [
        {
          curve: 'CURVE_SECP256K1',
          pathFormat: 'PATH_FORMAT_BIP32',
          path: "m/44'/60'/0'/0/0",
          addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
        },
      ],
    },
  });

  const subOrgId = createResp.subOrganizationId!;
  const wallet = createResp.wallet!;
  const walletAddress = wallet.addresses[0];

  console.log(`Sub-org created: ${subOrgId}`);
  console.log(`Wallet address: ${walletAddress}`);

  // Policy: only allow plain ETH transfers (no contract calls). Two-stamper
  // consensus identical to buyback configs. The Cloudflare Worker further
  // restricts the destination to known buyback wallets at co-sign time.
  const erc20Transfer = toFunctionSelector('transfer(address,uint256)').toLowerCase();
  // We *deny* anything where data has a function selector (length >= 10 with 0x prefix).
  // Since CEL's negation is a bit awkward, we phrase the allow as: data must be empty.
  const condition = `eth.tx.data == '0x'`;
  void erc20Transfer; // documented above for the reader

  const consensus =
    `approvers.any(user, user.id == '${parentAdminUserId}') ` +
    `&& approvers.any(user, user.id == '${coSignerUserId}')`;

  console.log('Attaching two-stamper "ETH-transfer-only" policy...');
  const policyResp = await client.createPolicy({
    organizationId: subOrgId,
    policyName: 'operator_gas_transfer_only',
    effect: 'EFFECT_ALLOW',
    consensus,
    condition,
    notes:
      'Operator gas wallet: permits only plain ETH transfers (no contract data). ' +
      'Requires consensus from both the parent-admin and the off-host co-signer. ' +
      'The Cloudflare Worker enforces "destination must be a known buyback wallet" ' +
      'before co-signing.',
  });
  console.log(`Policy attached: ${policyResp.policyId}`);

  console.log('\n--- Add these to your Railway env ---');
  console.log(`OPERATOR_TURNKEY_SUB_ORG_ID=${subOrgId}`);
  console.log(`OPERATOR_WALLET_ADDRESS=${walletAddress}`);
  console.log('\nNext: fund the operator wallet with ~0.005 ETH on Base.');
  console.log(`Send to: ${walletAddress}`);
}

main().catch((err) => {
  console.error('Provisioning failed:', err);
  process.exit(1);
});
