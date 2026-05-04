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

function getStamperUserIds(): { parentAdminUserId: string; coSignerUserId: string } {
  const parentAdminUserId = process.env.TURNKEY_PARENT_ADMIN_USER_ID;
  const coSignerUserId = process.env.TURNKEY_COSIGNER_USER_ID;
  if (!parentAdminUserId || !coSignerUserId) {
    throw new Error(
      'Two-stamper signing requires TURNKEY_PARENT_ADMIN_USER_ID and TURNKEY_COSIGNER_USER_ID',
    );
  }
  return { parentAdminUserId, coSignerUserId };
}

function getCoSignerEndpoint(override?: string | null): string {
  const url = override ?? process.env.BUYBACK_COSIGNER_URL;
  if (!url) {
    throw new Error(
      'Co-signer endpoint is not configured: set BUYBACK_COSIGNER_URL (or "stub" for non-prod local dev)',
    );
  }
  if (url === 'stub' && process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to use stub co-signer in production. Deploy the off-host co-signer worker and set BUYBACK_COSIGNER_URL to its URL.',
    );
  }
  return url;
}

export interface CreateBuybackSubOrgParams {
  agentId: string;
  // The end user's email — set as the root authenticator on the new sub-org so
  // they can claim/sweep via Turnkey's email auth flow at any time. Required.
  userEmail: string;
  policyParams: Omit<BuybackPolicyParams, 'parentAdminUserId' | 'coSignerUserId'>;
}

export interface BuybackSubOrgResult {
  subOrgId: string;
  walletId: string;
  walletAddress: `0x${string}`;
  policyId: string;
}

/**
 * Provisions a Turnkey sub-organization for a single agent's buyback wallet.
 *
 * Architecture (post-Piece-1):
 *   - Sub-org has exactly one user: the customer (their email = root authenticator).
 *   - Signing is performed by parent-org users (parent-admin + co-signer) acting
 *     into the sub-org. Both stampers must approve every activity per the
 *     attached policy. There is no per-sub-org delegated key, no on-disk secret,
 *     and no DB-stored key material.
 *   - Customer can revoke our consensus at any time via Turnkey email auth by
 *     editing or removing the policy in their sub-org.
 */
export async function createBuybackSubOrg(
  params: CreateBuybackSubOrgParams,
): Promise<BuybackSubOrgResult> {
  const client = getApiClient();
  const { parentAdminUserId, coSignerUserId } = getStamperUserIds();
  const { agentId, userEmail, policyParams } = params;

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

  // Attach the buyback policy. Consensus requires BOTH the parent-admin and
  // the co-signer to approve every activity. Cross-org user IDs work because
  // Turnkey treats user IDs as global identifiers — the sub-org policy just
  // references the parent-org users that will be acting into this sub-org.
  const policy = buildBuybackPolicy({
    ...policyParams,
    parentAdminUserId,
    coSignerUserId,
  });
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
    policyId,
  };
}

export interface SignTransactionParams {
  subOrgId: string;
  fromAddress: `0x${string}`;
  unsignedTx: TransactionSerializableEIP1559;
  // Per-config override for the co-signer endpoint. Falls back to env.
  coSignerEndpoint?: string | null;
}

const ACTIVITY_POLL_INTERVAL_MS = 1_000;
const ACTIVITY_POLL_TIMEOUT_MS = 60_000;

async function pollActivityUntilCompleted(
  organizationId: string,
  activityId: string,
): Promise<{ signedTransaction: string }> {
  const client = getApiClient();
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await client.getActivity({ organizationId, activityId });
    const status = resp.activity.status;
    if (status === 'ACTIVITY_STATUS_COMPLETED') {
      const signed = resp.activity.result?.signTransactionResult?.signedTransaction;
      if (!signed) {
        throw new Error(
          `Activity ${activityId} completed but had no signTransactionResult`,
        );
      }
      return { signedTransaction: signed };
    }
    if (status === 'ACTIVITY_STATUS_FAILED' || status === 'ACTIVITY_STATUS_REJECTED') {
      const reason = resp.activity.failure?.message ?? status;
      throw new Error(`Activity ${activityId} ended in ${status}: ${reason}`);
    }
    if (Date.now() - start > ACTIVITY_POLL_TIMEOUT_MS) {
      throw new Error(`Activity ${activityId} did not complete within ${ACTIVITY_POLL_TIMEOUT_MS}ms`);
    }
    await new Promise((r) => setTimeout(r, ACTIVITY_POLL_INTERVAL_MS));
  }
}

/**
 * Two-stamper signing flow.
 *
 * 1. Railway (parent-admin stamper) submits the signTransaction activity to
 *    Turnkey. Because the sub-org policy requires consensus from a second
 *    stamper, Turnkey records the activity in CONSENSUS_NEEDED state without
 *    executing the signature.
 * 2. Railway forwards the activityId to the off-host co-signer endpoint
 *    (Cloudflare Worker / Lambda — separate cloud account from Railway).
 * 3. The co-signer validates the activity matches the buyback shape, then
 *    calls Turnkey approveActivity with its own stamper key.
 * 4. Turnkey now has both stamps; the activity transitions to COMPLETED and
 *    the signed tx is produced.
 * 5. Railway polls until COMPLETED and returns the signed tx hex.
 *
 * For local dev where the co-signer worker isn't deployed, set
 * `BUYBACK_COSIGNER_URL=stub`. In that mode, signing falls back to a single
 * parent-admin stamp — Turnkey will accept it iff the sub-org's policy is
 * temporarily relaxed to single-stamper. **Never use stub in production**;
 * the env check throws otherwise.
 */
export async function signTransaction(
  params: SignTransactionParams,
): Promise<`0x${string}`> {
  const client = getApiClient();
  const { subOrgId, fromAddress, unsignedTx } = params;

  const unsignedSerialized = serializeTransaction(unsignedTx);
  const unsignedHex = unsignedSerialized.slice(2); // strip 0x

  // Step 1: Railway (parent-admin) stamps and submits.
  const submitResp = await client.signTransaction({
    organizationId: subOrgId,
    type: 'TRANSACTION_TYPE_ETHEREUM',
    signWith: fromAddress,
    unsignedTransaction: unsignedHex,
  });

  // If consensus already satisfied (stub mode with single-stamper policy), we're done.
  if (submitResp.signedTransaction) {
    return `0x${submitResp.signedTransaction}` as `0x${string}`;
  }

  // Step 2: forward to co-signer.
  const coSignerUrl = getCoSignerEndpoint(params.coSignerEndpoint);
  const activityId = (submitResp as any).activity?.id;
  if (!activityId) {
    throw new Error(
      'Turnkey signTransaction returned no signedTransaction and no activity id — cannot route to co-signer',
    );
  }

  if (coSignerUrl !== 'stub') {
    const sharedSecret = process.env.BUYBACK_COSIGNER_SHARED_SECRET;
    if (!sharedSecret) {
      throw new Error(
        'BUYBACK_COSIGNER_SHARED_SECRET is not set — Worker would reject our request',
      );
    }
    const coResp = await fetch(coSignerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cosigner-secret': sharedSecret,
      },
      body: JSON.stringify({
        kind: 'sign-transaction',
        subOrgId,
        activityId,
        fromAddress,
        unsignedTransaction: unsignedHex,
      }),
    });
    if (!coResp.ok) {
      const text = await coResp.text();
      throw new Error(
        `Co-signer rejected request (HTTP ${coResp.status}): ${text.slice(0, 500)}`,
      );
    }
  }

  // Step 3: poll until Turnkey reports COMPLETED.
  const final = await pollActivityUntilCompleted(subOrgId, activityId);
  return `0x${final.signedTransaction}` as `0x${string}`;
}
