import { Turnkey } from '@turnkey/sdk-server';
import { serializeTransaction, type TransactionSerializableEIP1559 } from 'viem';
import { buildBuybackPolicy, type BuybackPolicyParams } from '../lib/turnkeyPolicy';

let cachedClient: ReturnType<Turnkey['apiClient']> | null = null;

function getApiClient() {
  if (cachedClient) return cachedClient;

  const apiPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey = process.env.TURNKEY_API_PRIVATE_KEY;
  const parentOrgId = process.env.TURNKEY_PARENT_ORG_ID;
  const baseUrl = process.env.TURNKEY_API_BASE_URL || 'https://api.turnkey.com';

  if (!apiPublicKey || !apiPrivateKey || !parentOrgId) {
    throw new Error(
      'Turnkey is not configured: set TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, TURNKEY_PARENT_ORG_ID',
    );
  }

  const turnkey = new Turnkey({
    apiBaseUrl: baseUrl,
    apiPublicKey,
    apiPrivateKey,
    defaultOrganizationId: parentOrgId,
  });
  cachedClient = turnkey.apiClient();
  return cachedClient;
}

export interface CreateBuybackSubOrgParams {
  agentId: string;
  // The end user's email — set as the root authenticator on the new sub-org so
  // they can claim/sweep via Turnkey's email auth flow at any time. Required.
  userEmail: string;
  // Public key (compressed/uncompressed hex, no 0x prefix) for our delegated API key.
  // Generated server-side by the caller; we keep the matching private key in our secrets.
  delegatedApiPublicKey: string;
  policyParams: BuybackPolicyParams;
}

export interface BuybackSubOrgResult {
  subOrgId: string;
  walletId: string;
  walletAddress: `0x${string}`;
  delegatedUserId: string;
  delegatedApiKeyId: string;
  policyId: string;
}

/**
 * Provisions a Turnkey sub-organization for a single agent's buyback wallet.
 *
 * Architecture:
 *   - Root user = end user's email (so they can claim self-custody via Turnkey at any time).
 *   - Delegated user = us, with one API key whose policy is restricted to the buyback flow.
 *   - One ETH wallet inside the sub-org. Its address is set as the agent's buybackAddress
 *     so split distributions credit it.
 *
 * Even if our backend is fully compromised, the delegated key cannot drain the wallet —
 * Turnkey enforces the policy at signing time.
 */
export async function createBuybackSubOrg(
  params: CreateBuybackSubOrgParams,
): Promise<BuybackSubOrgResult> {
  const client = getApiClient();
  const { agentId, userEmail, delegatedApiPublicKey, policyParams } = params;

  const subOrgName = `buyback-${agentId.slice(0, 8)}-${Date.now().toString(36)}`;

  const createResp = await client.createSubOrganization({
    subOrganizationName: subOrgName,
    rootUsers: [
      {
        userName: 'agent-owner',
        userEmail,
        authenticators: [],
        apiKeys: [],
        oauthProviders: [],
      },
      {
        userName: 'earnkit-buyback-bot',
        authenticators: [],
        oauthProviders: [],
        apiKeys: [
          {
            apiKeyName: 'buyback-delegated-key',
            publicKey: delegatedApiPublicKey,
            curveType: 'API_KEY_CURVE_P256',
          },
        ],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: {
      walletName: 'buyback-wallet',
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

  const subOrgId = createResp.subOrganizationId;
  const wallet = createResp.wallet;
  if (!subOrgId || !wallet?.walletId || !wallet?.addresses?.[0]) {
    throw new Error(
      `Turnkey createSubOrganization succeeded but response missing required fields: ${JSON.stringify(createResp)}`,
    );
  }
  const walletAddress = wallet.addresses[0] as `0x${string}`;

  // Look up the user IDs of the just-created users so we can attach the policy to the bot.
  const usersResp = await client.getUsers({ organizationId: subOrgId });
  const botUser = usersResp.users.find((u) => u.userName === 'earnkit-buyback-bot');
  if (!botUser) {
    throw new Error(
      `Created sub-org ${subOrgId} but couldn't find the delegated bot user`,
    );
  }
  const delegatedUserId = botUser.userId;
  const delegatedApiKeyId = botUser.apiKeys?.[0]?.apiKeyId;
  if (!delegatedApiKeyId) {
    throw new Error(
      `Delegated user ${delegatedUserId} has no API key — sub-org provisioning incomplete`,
    );
  }

  // Attach the buyback policy. Turnkey policies are scoped per-sub-org, so this
  // policy only applies inside this agent's sub-org.
  const policy = buildBuybackPolicy(policyParams);
  const policyResp = await client.createPolicy({
    organizationId: subOrgId,
    policyName: policy.policyName,
    effect: policy.effect,
    consensus: policy.consensus,
    condition: policy.condition,
    notes: policy.notes,
  });
  const policyId = policyResp.policyId;
  if (!policyId) {
    throw new Error(`createPolicy returned no policyId for sub-org ${subOrgId}`);
  }

  return {
    subOrgId,
    walletId: wallet.walletId,
    walletAddress,
    delegatedUserId,
    delegatedApiKeyId,
    policyId,
  };
}

export interface SignTransactionParams {
  subOrgId: string;
  fromAddress: `0x${string}`;
  unsignedTx: TransactionSerializableEIP1559;
}

/**
 * Sign an EIP-1559 transaction via Turnkey using our delegated API key.
 * Turnkey enforces the sub-org's policy at signing time — txs that don't match
 * the buyback policy will be rejected here, not by the chain.
 *
 * Returns the RLP-encoded signed transaction hex, ready to broadcast via
 * publicClient.sendRawTransaction.
 */
export async function signTransaction(
  params: SignTransactionParams,
): Promise<`0x${string}`> {
  const client = getApiClient();
  const { subOrgId, fromAddress, unsignedTx } = params;

  // Turnkey's signTransaction expects the unsigned RLP-encoded tx as hex (no 0x).
  const unsignedSerialized = serializeTransaction(unsignedTx);
  const unsignedHex = unsignedSerialized.slice(2); // strip 0x

  const resp = await client.signTransaction({
    organizationId: subOrgId,
    type: 'TRANSACTION_TYPE_ETHEREUM',
    signWith: fromAddress,
    unsignedTransaction: unsignedHex,
  });

  if (!resp.signedTransaction) {
    throw new Error(
      `Turnkey signTransaction returned no signedTransaction for ${fromAddress}`,
    );
  }

  return `0x${resp.signedTransaction}` as `0x${string}`;
}

/**
 * Emergency: revoke our delegated API key on a sub-org. The user retains full
 * control via their root credential and can re-attach a fresh delegated key
 * later if they want to keep using auto-buyback.
 */
export async function revokeDelegatedKey(params: {
  subOrgId: string;
  delegatedUserId: string;
  delegatedApiKeyId: string;
}): Promise<void> {
  const client = getApiClient();
  await client.deleteApiKeys({
    organizationId: params.subOrgId,
    userId: params.delegatedUserId,
    apiKeyIds: [params.delegatedApiKeyId],
  });
}
