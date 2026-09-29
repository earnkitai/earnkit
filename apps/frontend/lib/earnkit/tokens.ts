import { z } from 'zod';
import { sql } from './db';

/**
 * Launching a token for a submitted project on tokens.fun, through its deploy API
 * (POST /api/v1/deploy, the route tokens.fun's own X bot uses). tokens.fun's gas wallet
 * pays; the builder's wallet is the creator and gets 40% of trading fees.
 * The deploy key (TOKENSFUN_DEPLOY_API_KEY) never leaves this server.
 */
const TOKENSFUN_URL = (
  process.env.TOKENSFUN_API_URL ?? 'https://tokens.fun'
).replace(/\/$/, '');

export const TOKEN_TERMS = {
  agreement: 'https://tokens.fun/token-creator-agreement',
  risks: 'https://tokens.fun/risk-disclosure',
};

const CHAIN_IDS = { base: 8453, robinhood: 4663, arbitrum: 42161 } as const;

export class LaunchError extends Error {}

/** "@name", "name", or an x.com / twitter.com profile URL → https://x.com/name. */
export function xProfileUrl(value: string) {
  const handle = value
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle))
    throw new LaunchError(`"${value}" isn't an X handle.`);
  return `https://x.com/${handle}`;
}

export const LaunchTokenInput = z
  .object({
    project_id: z.number().int().positive(),
    name: z.string().trim().min(1).max(50),
    symbol: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,10}$/, 'ticker: up to 10 letters or digits'),
    creator_wallet: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, 'a 0x wallet address'),
    image_url: z
      .string()
      .url()
      .startsWith('https://', 'must start with https://'),
    builder_x: z.string().trim().min(1),
    chain: z.enum(['base', 'robinhood', 'arbitrum']).default('base'),
    builder_confirmed: z.literal(true),
  })
  .strict();

type DeployResponse = {
  success?: boolean;
  tokenAddress?: string;
  txHash?: string;
  chainId?: number;
  urls?: { tokensfun?: string; explorer?: string };
  error?: string;
  message?: string;
};

/** What the agent tells the builder right after a submission is recorded. */
export function tokenOffer(projectName: string) {
  return (
    `Ask the builder once: "Want a token for ${projectName} on tokens.fun? tokens.fun pays the gas; ` +
    `40% of trading fees go to your wallet (in WETH). Terms: ${TOKEN_TERMS.agreement} · Risks: ` +
    `${TOKEN_TERMS.risks}" If yes, confirm name, ticker, their wallet, an https image (a logo from ` +
    "the project's repo works), and their X, then call launch_token. If no, drop it."
  );
}

export async function launchToken(
  input: z.infer<typeof LaunchTokenInput>,
  installationId: number,
) {
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  if (!key)
    throw new LaunchError('Token launches are not available right now.');
  const twitter = xProfileUrl(input.builder_x);

  // Claim the project atomically: only this installation's project, only if it has no token.
  // The claim stays if the outcome is unknown, so a lost response can't lead to a second token.
  const [project] = await sql()<
    {
      name: string;
      description: string | null;
      repo_url: string | null;
      live_url: string | null;
    }[]
  >`
    UPDATE projects SET token_url = 'pending'
    WHERE id = ${input.project_id} AND installation_id = ${installationId} AND token_url IS NULL
    RETURNING name, description, repo_url, live_url`;
  if (!project) {
    const [existing] = await sql()<
      { token_url: string | null; installation_id: number | null }[]
    >`
      SELECT token_url, installation_id FROM projects WHERE id = ${input.project_id}`;
    if (!existing || existing.installation_id !== installationId) {
      throw new LaunchError(
        `No project ${input.project_id} recorded by you. Call record_submission first.`,
      );
    }
    throw new LaunchError(
      existing.token_url === 'pending'
        ? 'A launch for this project is in progress or unconfirmed. Check tokens.fun before trying again.'
        : `This project already has a token: ${existing.token_url}`,
    );
  }

  const release = () =>
    sql()`UPDATE projects SET token_url = NULL WHERE id = ${input.project_id}`;
  const website = project.live_url ?? project.repo_url ?? undefined;

  let res: Response;
  try {
    res = await fetch(`${TOKENSFUN_URL}/api/v1/deploy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        symbol: input.symbol,
        creatorWallet: input.creator_wallet,
        tokenURI: input.image_url,
        imageUrl: input.image_url,
        description:
          project.description ?? `${project.name}, built with EarnKit.`,
        ...(website && { website, appUrl: project.live_url ?? undefined }),
        twitter,
        chainId: CHAIN_IDS[input.chain],
        source: 'earnkit',
        tokenSource: 'external',
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    // The launch may still have happened; keep the claim so it can't be launched twice.
    throw new LaunchError(
      'No response from tokens.fun. Check tokens.fun for the token before trying again.',
    );
  }

  const data = (await res.json().catch(() => ({}))) as DeployResponse;
  if (!res.ok || !data.success || !data.tokenAddress) {
    await release(); // tokens.fun validates before minting, so a failed response launched nothing
    const reason =
      res.status === 429
        ? 'tokens.fun launch limit reached. Try again later.'
        : (data.message ?? data.error ?? `tokens.fun returned ${res.status}`);
    throw new LaunchError(`Token not launched: ${reason}`);
  }

  const page =
    data.urls?.tokensfun ?? `https://tokens.fun/coin/${data.tokenAddress}`;
  await sql()`UPDATE projects SET token_url = ${page} WHERE id = ${input.project_id}`;
  return {
    launched: true,
    token_address: data.tokenAddress,
    chain: input.chain,
    tx_hash: data.txHash,
    tokens_fun: page,
    explorer: data.urls?.explorer,
    fees:
      "40% of trading fees go to the creator wallet in WETH (after Clanker's 20% protocol cut); " +
      'the rest is platform 50% and MINI buyback 10%.',
  };
}
