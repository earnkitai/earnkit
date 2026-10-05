import { normalizeRepoUrl } from './campaigns';
import { sql } from './db';
import { retryText } from './rate-limit';

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

const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) =>
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Decodes and checks an uploaded token image: an allowed type whose bytes match it, up to 1 MB. */
export function decodeImage(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/);
  const check = m && IMAGE_TYPES[m[1]];
  if (!m || !check)
    throw new LaunchError(
      'image_data must be a base64 data URL of a PNG, JPEG, WebP, or GIF.',
    );
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 1_000_000)
    throw new LaunchError('image_data is over 1 MB.');
  if (!check(bytes)) throw new LaunchError(`image_data isn't a valid ${m[1]}.`);
  return { bytes, type: m[1] };
}

type DeployResponse = {
  success?: boolean;
  tokenAddress?: string;
  txHash?: string;
  chainId?: number;
  urls?: { tokensfun?: string; explorer?: string };
  error?: string;
  message?: string;
  /** Seconds until tokens.fun accepts another launch (on a 429), when it says. */
  retryAfter?: number;
};

export type TokenStatus =
  | 'skipped'
  | 'gate_failed'
  | 'pending'
  | 'launched'
  | 'failed';

export type TokenOutcome = {
  status: TokenStatus;
  name?: string;
  symbol?: string;
  note?: string;
  token_address?: string;
  tokens_fun?: string;
  explorer?: string;
  tx_hash?: string;
};

/** What the builder is told about fee splits once a token is live. */
export const EARNINGS_LINE = (wallet: string) =>
  `You keep 40% of trading fees (after Clanker's 20% protocol cut), paid in WETH to ${wallet}. tokens.fun pays the gas.`;

/**
 * Maps a tokens.fun deploy response to a TokenOutcome, plus whether the launch claim
 * (`token_url = 'pending'`) should be released. `res`/`data` null means no response came back at
 * all (lost connection, or the request itself threw): the claim is kept.
 *
 * The claim is released ONLY when the status is 4xx and the body parsed as JSON — validation
 * errors (400), auth errors (401/403) and the 429 daily limit, all refusals tokens.fun makes
 * before minting. Everything else keeps the claim pending, since tokens.fun may have minted
 * anyway and a release could let a second, permanent token through:
 *   - any 5xx, with or without a parsed body (tokens.fun itself is unsure, e.g. its 502
 *     "Deployment status unknown" after a deploy-tx timeout);
 *   - a 2xx whose body didn't say success with a tokenAddress;
 *   - a body that failed to parse as JSON, at any status.
 * Pure; exported for tests.
 */
export function outcomeOf(
  res: { ok: boolean; status: number } | null,
  data: DeployResponse | null,
  chain: 'base' | 'robinhood' | 'arbitrum',
): TokenOutcome & { release: boolean } {
  if (!res) {
    return {
      status: 'pending',
      note: 'No answer from tokens.fun. The launch may have happened: check tokens.fun before retrying.',
      release: false,
    };
  }
  if (res.ok && data?.success && data.tokenAddress) {
    const page =
      data.urls?.tokensfun ?? `https://tokens.fun/coin/${data.tokenAddress}`;
    return {
      status: 'launched',
      token_address: data.tokenAddress,
      tokens_fun: page,
      explorer: data.urls?.explorer,
      tx_hash: data.txHash,
      release: false,
    };
  }
  const isClientRefusal =
    res.status >= 400 && res.status < 500 && data !== null;
  if (isClientRefusal) {
    // A 4xx with a parsed body is tokens.fun refusing before minting: safe to release.
    const said =
      data?.message ?? data?.error ?? `tokens.fun returned ${res.status}`;
    const retry =
      typeof data?.retryAfter === 'number' && data.retryAfter > 0
        ? `in ${retryText(data.retryAfter)}`
        : 'later';
    const note =
      res.status === 429
        ? `tokens.fun's launch limit was reached (${said}). Say 'launch the token' ${retry}.`
        : `Token not launched: ${said}`;
    return { status: 'failed', note, release: true };
  }
  // 5xx, an unparsed body, or a 2xx that didn't confirm success: tokens.fun didn't clearly say
  // the launch failed, so keep the claim and let the builder check before retrying.
  return {
    status: 'pending',
    note: `tokens.fun couldn't confirm the launch (tokens.fun returned ${res.status}): check tokens.fun before retrying.`,
    release: false,
  };
}

/**
 * Sets a project's token status (and, when given, its name/symbol), with an optional note. Only
 * for a project with no token or launch claim (`token_url IS NULL`): a concurrent claim's
 * 'pending' and a launched token are never overwritten.
 */
export async function setTokenStatus(
  projectId: number,
  s: {
    status: TokenStatus;
    note?: string | null;
    name?: string | null;
    symbol?: string | null;
  },
): Promise<void> {
  const fields: Record<string, unknown> = {
    token_status: s.status,
    token_note: s.note ?? null,
  };
  if (s.name !== undefined) fields.token_name = s.name;
  if (s.symbol !== undefined) fields.token_symbol = s.symbol;
  await sql()`UPDATE projects SET ${sql()(fields)} WHERE id = ${projectId} AND token_url IS NULL`;
}

/** Whether token launches are configured on this deployment (the tokens.fun deploy key is set). */
export const tokenLaunchesAvailable = () =>
  Boolean(process.env.TOKENSFUN_DEPLOY_API_KEY);

export const TOKENS_UNAVAILABLE = "Token launches aren't available right now.";

/** The claim found the project's links changed after the gate checked them. */
export const LINKS_CHANGED =
  "The project's links changed during the launch; call launch_token again.";

/** The claim matched nothing although the project had no token: something changed meanwhile. */
export const STATE_CHANGED =
  'The project changed during the launch (nothing was launched); call launch_token again.';

/** Starts every "another project on this repo has a token" note. */
export const REPO_HAS_TOKEN = 'This repo already has a token';

/** The note for a repo whose token (or launch in progress) belongs to another project. */
export const repoHasTokenNote = (url: string) =>
  url === 'pending'
    ? `${REPO_HAS_TOKEN} launch in progress (another entry of it). Check tokens.fun before trying again.`
    : `${REPO_HAS_TOKEN}: ${url}`;

/**
 * The token link (or 'pending') of another project on the same normalized repo, or null. Only
 * EarnKit's own claims count (token_repo_key, set when a launch is claimed after the ownership
 * gate): a token_url a builder typed into record_submission is unproven, and counting it would let
 * anyone block someone else's repo.
 */
export async function repoTokenUrl(
  projectId: number,
  repoKey: string,
): Promise<string | null> {
  const [row] = await sql()<{ token_url: string }[]>`
    SELECT token_url FROM projects
    WHERE token_repo_key = ${repoKey} AND token_url IS NOT NULL AND id <> ${projectId} LIMIT 1`;
  return row?.token_url ?? null;
}

/**
 * Launches a token for a submitted project on tokens.fun: claims the project, resolves the image,
 * POSTs the deploy, and records the outcome. The claim (`token_url = 'pending'`) is set first and
 * released ONLY on a 4xx response tokens.fun parsed as JSON (a refusal before minting: bad input,
 * auth, or the daily limit). Any other outcome — no response, a 5xx, or a body that didn't parse —
 * keeps the claim pending, since tokens.fun may have minted anyway and a retry must not risk a
 * second, permanent token.
 */
export async function deployToken(
  a: {
    projectId: number;
    installationId: number;
    name: string;
    symbol: string;
    creatorWallet: string;
    image: { bytes: Buffer; type: string } | null;
    imageUrl?: string;
    builderX?: string;
    chain?: 'base' | 'robinhood' | 'arbitrum';
    /**
     * The repo and live links the gate checked. The claim only matches while the row still holds
     * exactly these, token_repo_key comes from the repo here (never a re-read), and tokens.fun's
     * metadata uses them.
     */
    repoUrl: string | null;
    liveUrl: string | null;
  },
  deps: { fetch?: typeof fetch } = {},
): Promise<TokenOutcome> {
  const chain = a.chain ?? 'base';
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  if (!key)
    throw new LaunchError('Token launches are not available right now.');
  const twitter = a.builderX ? xProfileUrl(a.builderX) : undefined;
  const origin = (process.env.EARNKIT_URL ?? 'https://earnkit.com').replace(
    /\/$/,
    '',
  );

  // One launched or pending token per repo across EarnKit (v2.3 Ruling 12): the claim records the
  // normalized repo (token_repo_key; a unique partial index backs it), and refuses when another
  // project on the same repo has a token or a claim.
  const [mine] = await sql()<{ installation_id: number | null }[]>`
    SELECT installation_id FROM projects WHERE id = ${a.projectId}`;
  if (!mine || mine.installation_id !== a.installationId)
    throw new LaunchError(
      `No project ${a.projectId} recorded by you. Call record_submission first.`,
    );
  const repoKey = a.repoUrl ? normalizeRepoUrl(a.repoUrl) : null;
  if (repoKey) {
    const other = await repoTokenUrl(a.projectId, repoKey);
    if (other) return { status: 'failed', note: repoHasTokenNote(other) };
  }

  // Claim the project atomically: only this installation's project, only if it has no token yet,
  // only while its links are still the ones the gate checked (launch_token can change them), only
  // if no other project on its repo has one. The claim (token_url = 'pending') is released
  // ONLY when tokens.fun answers 4xx with a parsed JSON body (it refused before minting); every
  // other outcome keeps it (see outcomeOf).
  let claimed;
  try {
    claimed = await sql()<
      {
        name: string;
        description: string | null;
        repo_url: string | null;
        live_url: string | null;
      }[]
    >`
    UPDATE projects SET token_url = 'pending', token_status = 'pending', token_note = NULL,
      token_name = ${a.name}, token_symbol = ${a.symbol}, token_repo_key = ${repoKey},
      token_image = ${a.image?.bytes ?? null}, token_image_type = ${a.image?.type ?? null}
    WHERE id = ${a.projectId} AND installation_id = ${a.installationId} AND token_url IS NULL
      AND repo_url IS NOT DISTINCT FROM ${a.repoUrl}::text
      AND live_url IS NOT DISTINCT FROM ${a.liveUrl}::text
      AND (${repoKey}::text IS NULL OR NOT EXISTS (
        SELECT 1 FROM projects o
        WHERE o.token_repo_key = ${repoKey} AND o.token_url IS NOT NULL AND o.id <> ${a.projectId}))
    RETURNING name, description, repo_url, live_url`;
  } catch (err) {
    // Two claims on one repo at once: the unique index lets only one through.
    if (
      (err as { constraint_name?: string }).constraint_name ===
      'projects_token_repo_key'
    ) {
      const other = repoKey && (await repoTokenUrl(a.projectId, repoKey));
      return { status: 'failed', note: repoHasTokenNote(other || 'pending') };
    }
    throw err;
  }
  const [project] = claimed;
  if (!project) {
    const [existing] = await sql()<
      {
        token_url: string | null;
        installation_id: number | null;
        repo_url: string | null;
        live_url: string | null;
      }[]
    >`
      SELECT token_url, installation_id, repo_url, live_url FROM projects WHERE id = ${a.projectId}`;
    if (!existing || existing.installation_id !== a.installationId) {
      throw new LaunchError(
        `No project ${a.projectId} recorded by you. Call record_submission first.`,
      );
    }
    if (!existing.token_url && repoKey) {
      const other = await repoTokenUrl(a.projectId, repoKey);
      if (other) return { status: 'failed', note: repoHasTokenNote(other) };
    }
    // Nothing was claimed, so there is nothing to release.
    if (!existing.token_url)
      // The links changed after the gate, or a claim on the repo came and went in between: the
      // project's state moved under this launch either way.
      return {
        status: 'failed',
        note:
          existing.repo_url !== a.repoUrl || existing.live_url !== a.liveUrl
            ? LINKS_CHANGED
            : STATE_CHANGED,
      };
    return {
      status: 'failed',
      note:
        existing.token_url === 'pending'
          ? 'A launch for this project is in progress or unconfirmed. Check tokens.fun before trying again.'
          : `This project already has a token: ${existing.token_url}`,
    };
  }

  const imageUrl = a.image
    ? `${origin}/api/projects/${a.projectId}/image`
    : (a.imageUrl ??
      // The ticker is in the link, so the year-long cache never serves another ticker's logo.
      `${origin}/api/projects/${a.projectId}/token-image?s=${encodeURIComponent(a.symbol)}`);
  const website = a.liveUrl ?? a.repoUrl ?? undefined;
  const doFetch = deps.fetch ?? fetch;

  // EARNKIT_TOKENSFUN_TIMEOUT_MS bounds the deploy fetch (default 120s); a later e2e lowers it
  // to exercise the pending (no-response) path without waiting out the real timeout. Parsed once,
  // and only used if it's a positive integer — an unset, blank, or malformed value (NaN from '')
  // must not collapse the timeout to 0 and abort instantly.
  const rawTimeoutMs = Number(process.env.EARNKIT_TOKENSFUN_TIMEOUT_MS);
  const timeoutMs =
    Number.isInteger(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 120_000;

  let res: Response | null;
  let data: DeployResponse | null;
  try {
    res = await doFetch(`${TOKENSFUN_URL}/api/v1/deploy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: a.name,
        symbol: a.symbol,
        creatorWallet: a.creatorWallet,
        tokenURI: imageUrl,
        imageUrl,
        description:
          project.description ?? `${project.name}, built with EarnKit.`,
        ...(website && { website, appUrl: a.liveUrl ?? undefined }),
        ...(twitter && { twitter }),
        chainId: CHAIN_IDS[chain],
        source: 'earnkit',
        tokenSource: 'external',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    data = (await res.json().catch(() => null)) as DeployResponse | null;
  } catch {
    res = null;
    data = null;
  }

  const { release, ...outcome } = outcomeOf(
    res ? { ok: res.ok, status: res.status } : null,
    data,
    chain,
  );

  if (release) {
    await sql()`
      UPDATE projects SET token_url = NULL, token_status = 'failed', token_note = ${outcome.note ?? null}
      WHERE id = ${a.projectId}`;
  } else if (outcome.status === 'launched') {
    await sql()`
      UPDATE projects SET token_url = ${outcome.tokens_fun ?? null}, token_status = 'launched', token_note = NULL
      WHERE id = ${a.projectId}`;
    // v2.5: the coin's address, which the builder bonus ledger attributes fee deposits by. Its own
    // write: a duplicate (unique index) is logged and never stops the launch being recorded.
    const coin = outcome.token_address && /^0x[0-9a-fA-F]{40}$/.test(outcome.token_address)
      ? outcome.token_address.toLowerCase()
      : null;
    if (coin)
      // coin_launched_at: an entry counts in a round only if launched before its end (Ruling 16).
      await sql()`UPDATE projects SET coin_address = ${coin}, coin_launched_at = COALESCE(coin_launched_at, now())
        WHERE id = ${a.projectId}`.catch((err: unknown) =>
        console.error(`[launch] project ${a.projectId}: coin ${coin} not recorded for the builder bonus`, err),
      );
  } else {
    // pending: token_url stays 'pending' from the claim above; only the note changes.
    await sql()`UPDATE projects SET token_note = ${outcome.note ?? null} WHERE id = ${a.projectId}`;
  }

  return { ...outcome, name: a.name, symbol: a.symbol };
}
