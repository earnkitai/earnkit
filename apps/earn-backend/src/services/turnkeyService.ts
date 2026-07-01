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

function getStamperPublicKeys(): { parentAdminPublicKey: string; coSignerPublicKey: string } {
  const parentAdminPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const coSignerPublicKey = process.env.TURNKEY_COSIGNER_PUBLIC_KEY;
  if (!parentAdminPublicKey || !coSignerPublicKey) {
    throw new Error(
      'Two-stamper signing requires TURNKEY_API_PUBLIC_KEY (parent admin) and TURNKEY_COSIGNER_PUBLIC_KEY (off-host cosigner)',
    );
  }
  return { parentAdminPublicKey, coSignerPublicKey };
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

// Returned by createBuybackSubOrgWallet — includes sub-org-local stamper user
// IDs needed later to attach the policy (via attachBuybackPolicy).
export interface BuybackSubOrgWalletResult {
  subOrgId: string;
  walletId: string;
  walletAddress: `0x${string}`;
  parentAdminUserId: string;
  coSignerUserId: string;
}

/**
 * Creates a Turnkey sub-org + wallet WITHOUT attaching a policy.
 * Use this when the buyback target token is not yet known (e.g. token creation
 * flow where the token address only exists after on-chain deployment).
 * Call attachBuybackPolicy once the token address is available.
 */
export async function createBuybackSubOrgWallet(params: {
  agentId: string;
  userEmail: string;
}): Promise<BuybackSubOrgWalletResult> {
  const client = getApiClient();
  const { parentAdminPublicKey, coSignerPublicKey } = getStamperPublicKeys();
  const { agentId, userEmail } = params;

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
        userName: 'platform-parent-admin',
        authenticators: [],
        apiKeys: [
          {
            apiKeyName: 'railway-parent-admin',
            publicKey: parentAdminPublicKey,
            curveType: 'API_KEY_CURVE_P256',
          },
        ],
        oauthProviders: [],
      },
      {
        userName: 'platform-cosigner',
        authenticators: [],
        apiKeys: [
          {
            apiKeyName: 'cloudflare-cosigner',
            publicKey: coSignerPublicKey,
            curveType: 'API_KEY_CURVE_P256',
          },
        ],
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
  const rootUserIds = createResp.rootUserIds;
  if (
    !subOrgId ||
    !wallet?.walletId ||
    !wallet?.addresses?.[0] ||
    !rootUserIds ||
    rootUserIds.length < 3
  ) {
    throw new Error(
      `Turnkey createSubOrganization succeeded but response missing required fields: ${JSON.stringify(createResp)}`,
    );
  }

  return {
    subOrgId,
    walletId: wallet.walletId,
    walletAddress: wallet.addresses[0] as `0x${string}`,
    // rootUserIds order matches the rootUsers array above
    parentAdminUserId: rootUserIds[1],
    coSignerUserId: rootUserIds[2],
  };
}

export interface AttachBuybackPolicyParams {
  subOrgId: string;
  parentAdminUserId: string;
  coSignerUserId: string;
  policyParams: Omit<BuybackPolicyParams, 'parentAdminUserId' | 'coSignerUserId'>;
  // Optional name override. Turnkey requires policy names unique per org, so
  // re-attaching a policy to an existing sub-org (e.g. a V3 -> V4 migration)
  // must use a distinct name from the one already there.
  policyName?: string;
}

/**
 * Builds and attaches the buyback policy to an existing sub-org.
 * Must be called after createBuybackSubOrgWallet once the target token address
 * is known.
 */
export async function attachBuybackPolicy(
  params: AttachBuybackPolicyParams,
): Promise<{ policyId: string }> {
  const client = getApiClient();
  const { subOrgId, parentAdminUserId, coSignerUserId, policyParams, policyName } = params;

  const policy = buildBuybackPolicy({
    ...policyParams,
    parentAdminUserId,
    coSignerUserId,
  });
  const policyResp = await client.createPolicy({
    organizationId: subOrgId,
    policyName: policyName ?? policy.policyName,
    effect: policy.effect,
    consensus: policy.consensus,
    condition: policy.condition,
    notes: policy.notes,
  });
  const policyId = policyResp.policyId;
  if (!policyId) {
    throw new Error(`createPolicy returned no policyId for sub-org ${subOrgId}`);
  }
  return { policyId };
}

/**
 * Fetch the parent-admin and co-signer stamper user IDs for an EXISTING buyback
 * sub-org. These are sub-org root users created at provisioning (userNames
 * 'platform-parent-admin' / 'platform-cosigner'). Needed to (re)build a policy's
 * consensus for configs where these IDs were never persisted to the DB.
 */
export async function getSubOrgStamperUserIds(
  subOrgId: string,
): Promise<{ parentAdminUserId: string; coSignerUserId: string }> {
  const client = getApiClient();
  const resp = await client.getUsers({ organizationId: subOrgId });
  const users = (resp.users ?? []) as Array<{ userId?: string; userName?: string }>;
  const parentAdmin = users.find((u) => u.userName === 'platform-parent-admin');
  const coSigner = users.find((u) => u.userName === 'platform-cosigner');
  if (!parentAdmin?.userId || !coSigner?.userId) {
    throw new Error(
      `Could not find platform stamper users in sub-org ${subOrgId} ` +
        `(found: ${users.map((u) => u.userName).join(', ')})`,
    );
  }
  return { parentAdminUserId: parentAdmin.userId, coSignerUserId: coSigner.userId };
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
  const { agentId, userEmail, policyParams } = params;

  const wallet = await createBuybackSubOrgWallet({ agentId, userEmail });
  const { policyId } = await attachBuybackPolicy({
    subOrgId: wallet.subOrgId,
    parentAdminUserId: wallet.parentAdminUserId,
    coSignerUserId: wallet.coSignerUserId,
    policyParams,
  });

  return {
    subOrgId: wallet.subOrgId,
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
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
