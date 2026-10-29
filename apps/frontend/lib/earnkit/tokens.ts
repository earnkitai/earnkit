import { normalizeRepoUrl } from './campaigns';
import { CHAIN_NAMES, type Chain } from './chains';
import { type Application, plainProblem } from './coach';
import { sql } from './db';
import { quoted } from './untrusted-text';

/**
 * Launching a token for a submitted project on tokens.fun, through its deploy API
 * (POST /api/v1/deploy, the route tokens.fun's own X bot uses). tokens.fun's gas wallet
 * pays; the builder's wallet is the creator and gets 40% of trading fees.
 * The deploy key (TOKENSFUN_DEPLOY_API_KEY) never leaves this server.
 */
/**
 * tokens.fun's API host (TOKENSFUN_API_URL overrides it for tests and the e2e mocks). Read per call,
 * never at import (v2.9 T12): a module that loads tokens.ts early must not freeze the host before a
 * test or the e2e sets its mock, or a test's deploy reaches the real tokens.fun.
 */
export const tokensFunUrl = () => (process.env.TOKENSFUN_API_URL ?? 'https://tokens.fun').replace(/\/$/, '');

export const TOKEN_TERMS = {
  agreement: 'https://tokens.fun/token-creator-agreement',
  risks: 'https://tokens.fun/risk-disclosure',
};

/** tokens.fun chain ids (person-score.ts reads them back to name a launched coin's chain). */
export const CHAIN_IDS = { base: 8453, robinhood: 4663, arbitrum: 42161 } as const;
/** v4 (2026-10-28): tokens launch on Base only (tokens.fun refuses any other chain). Other chains stay in CHAIN_IDS for scoring. */
export type LaunchChain = 'base';

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

/**
 * v2.10 item 12: the type of a fetched logo by its bytes (the checks decodeImage uses): PNG, JPEG
 * or WebP, else null (GIF, SVG, HTML and anything else). Pure.
 */
export function imageTypeOf(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  for (const type of ['image/png', 'image/jpeg', 'image/webp'] as const)
    if (IMAGE_TYPES[type](bytes)) return type;
  return null;
}

/**
 * v2.10 Ruling H7: an agent's image_url that may carry a secret is never sent onchain: one with
 * userinfo, a `token`, `sig` or `key` query parameter, or a raw.githubusercontent.com link with any
 * query (a private-repo raw link carries its token there). Pure.
 */
export function unsafeImageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.username || u.password) return true;
  if ([...u.searchParams.keys()].some((k) => /^(token|sig|key)$/i.test(k))) return true;
  return u.hostname.toLowerCase() === 'raw.githubusercontent.com' && u.search !== '';
}

type DeployResponse = {
  success?: boolean;
  tokenAddress?: string;
  txHash?: string;
  chainId?: number;
  urls?: { tokensfun?: string; explorer?: string };
  error?: string;
  message?: string;
  /** v2.8.1: tokens.fun's explicit "nothing was minted" flag, when it sends one. */
  minted?: boolean;
  /** Seconds until tokens.fun accepts another launch (on a 429), the older field. */
  retryAfter?: number;
  /** v2.8.1 (tokens.fun T1): when the next launch is accepted: `{ at, seconds }`, or an ISO time or seconds. */
  retry_after?: string | number | { at?: unknown; seconds?: unknown };
  retry_after_seconds?: number;
};

/**
 * v2.8.1 §A4: when tokens.fun accepts the next launch, from its 429: the JSON `retry_after` (an ISO
 * time, or seconds), `retry_after_seconds`, the older `retryAfter` (seconds), then the `Retry-After`
 * header (seconds or an HTTP date). Null when none is usable. Pure; exported for tests.
 */
export function retryAtOf(
  data: Pick<DeployResponse, 'retry_after' | 'retry_after_seconds' | 'retryAfter'> | null,
  header: string | null,
  now: Date,
): Date | null {
  const inSeconds = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? new Date(now.getTime() + v * 1000) : null;
  const at = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) return null;
    if (/^\d+(\.\d+)?$/.test(v.trim())) return inSeconds(Number(v));
    const t = Date.parse(v);
    return Number.isFinite(t) && t > now.getTime() ? new Date(t) : null;
  };
  const ra = data?.retry_after;
  return (
    (ra && typeof ra === 'object' ? (at(ra.at) ?? inSeconds(ra.seconds)) : null) ??
    (typeof ra === 'number' ? inSeconds(ra) : at(ra)) ??
    inSeconds(data?.retry_after_seconds) ??
    inSeconds(data?.retryAfter) ??
    at(header)
  );
}

/** "Try again after 14:20 UTC." (v2.8.1 §A4), or "Try again in a few hours." with no time. Pure. */
export function tryAgainAfter(at: Date | null): string {
  if (!at) return 'Try again in a few hours.';
  // Rounded up to the minute, so the builder never retries a few seconds early.
  const up = new Date(Math.ceil(at.getTime() / 60_000) * 60_000);
  return `Try again after ${up.toISOString().slice(11, 16)} UTC.`;
}

/** v2.8.1 §A5: the builder's line while a deploy runs on past the reply. */
export const LAUNCHING = 'Your token is launching. Ask me again in a minute for its link.';
/** v2.8.1 §A5: the agent's side of LAUNCHING (it names no tool, but it is the agent's instruction). */
export const LAUNCHING_AGENT =
  'The deploy is still running. In about 30 seconds call confirm again with the same arguments plus check: true: it returns the result and never starts another launch.';

/**
 * v2.8.1 §A1: the launch's outcome is unknown (no answer, or a 5xx that may have minted) or it has
 * been pending for over 10 minutes. The claim stays; the cron alerts the owner, who settles it.
 */
export const LAUNCH_STUCK =
  "Your token didn't launch yet; EarnKit is checking what happened with tokens.fun. Ask me again later.";
/** The agent's side of LAUNCH_STUCK (never a retry: a second token would be public and permanent). */
export const launchStuckAgent = (detail: string) =>
  `${detail} The launch may have happened, so it is never retried; EarnKit's owner is alerted and settles it.`;

/** v2.8.1 §A1: nothing was minted and the claim was released; the builder retries with one word. */
export const NOT_LAUNCHED_YET = "Your token didn't launch yet; say 'launch the token' to try again.";

/** v2.8.1 §A4: tokens.fun's own daily limit for the creator wallet. */
export const walletLimitNote = (at: Date | null) =>
  `Your token didn't launch: this wallet reached today's launch limit. ${tryAgainAfter(at)}`;

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
  /** v2.6 Ruling 18 (plan): skipped at submission because no wallet was given (no coin yet). */
  no_wallet?: true;
  /** C7: not launched because the entry still misses required items: those items as one list (todoList). */
  needs?: string;
  /**
   * Final review M7: for the agent only (e.g. the exact proof line to write and push), never shown
   * to the builder; `note` stays in plain builder words.
   */
  agent_note?: string;
  /**
   * v2.8 Ruling 4 (plan), confirm_entry only: the agent can fix this now (a wallet, a ticker, the
   * proof line, a transient read) and confirm again; no submit kit until then.
   */
  fixable?: boolean;
  /** Ruling C24: confirm mode, the repo's proof line isn't there (yet). */
  proof_line?: true;
  /** v2.8.1 fix round 1: C6 found this ticker (the one shown) taken; `symbol` is the next suggestion. */
  ticker_taken?: string;
  /** v2.8.1 §A3: the repo's default branch, where the proof line goes (when the gate read it). */
  proof_branch?: string;
  /**
   * v2.8.1 §A5: the reply time ran out while the deploy runs on (status 'pending'); the next call
   * returns the result.
   */
  launching?: true;
  /** v2.9 B9: the one-time GitHub sign-in link that proves the repo instead of the proof line. */
  sign_in?: string;
  /** v2.9 B9: the gate needs a GitHub sign-in (G10: a shared client) or a new one (G11: another wallet). */
  sign_in_needed?: 'needed' | 'wallet_changed';
};

/** tokens.fun's "Pending transactions detected" 503: its one gas wallet is busy (nothing sent). */
const PENDING_TX = 'Pending transactions detected';
/**
 * v2.8.1 fix round 1: tokens.fun's deploy route's own 503 texts, every one returned before the deploy
 * transaction (tf:app/api/v1/deploy/route.ts at cc46fa2), matched exactly (the two with a variable
 * part by their fixed start). Until tokens.fun sends `minted: false` on them (Ruling F3), only these
 * release a claim on a 503. Pure.
 */
export function knownPreMint503(error: unknown): boolean {
  if (typeof error !== 'string') return false;
  return (
    [
      'Pending transactions detected. Try again in a few minutes.',
      'Server configuration error',
      "EarnKit fee split isn't configured",
      'Server wallet configuration incomplete (ADMIN_WALLET)',
      'Server wallet configuration incomplete (BUYBACK_WALLET)',
    ].includes(error) || /^Cannot price [A-Za-z0-9]+ right now, so the launch tick cannot be set\. Try again shortly\.$/.test(error)
  );
}

/**
 * Maps a tokens.fun deploy response to a TokenOutcome, plus whether the launch claim
 * (`token_url = 'pending'`) should be released and (v2.8.1 §A1) whether a release may be retried
 * once at once. `res`/`data` null means no response came back at all (lost connection, or the
 * request itself threw): the claim is kept.
 *
 * Never released when the body carries a tx hash or a token address: something may be on chain.
 * Otherwise the claim is released ONLY when tokens.fun said, in a parsed JSON body, that it stopped
 * before minting:
 *   - any 4xx: validation (400), auth (401/403), the daily limit (429);
 *   - v2.8.1 §A1, `retry: true`: an explicit `minted: false` (Ruling F3), or a 503 whose `error` is
 *     one of tokens.fun's own pre-mint texts, matched exactly (knownPreMint503). A revert without
 *     `minted: false` is kept.
 * Everything else keeps the claim pending, since tokens.fun may have minted anyway and a release
 * could let a second, permanent token through: its 502 "Deployment status unknown" (a deploy-tx
 * timeout), its catch-all 500 "Internal server error" (thrown anywhere, even after a broadcast),
 * any other 5xx, a 2xx whose body didn't say success with a tokenAddress, and any unparsed body.
 * `retryAt` (§A4): when a 429's next launch is accepted (retryAtOf). Pure; exported for tests.
 */
export function outcomeOf(
  res: { ok: boolean; status: number } | null,
  data: DeployResponse | null,
  chain: LaunchChain,
  retryAt: Date | null = null,
): TokenOutcome & { release: boolean; retry?: true; busy?: true; chain_id?: number } {
  if (!res) {
    return {
      status: 'pending',
      note: LAUNCH_STUCK,
      agent_note: launchStuckAgent('No answer from tokens.fun.'),
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
      // v2.13 T9 (F8): the chain tokens.fun says it launched on, else the one asked for. Internal: deployToken writes it.
      chain_id: Number.isSafeInteger(data.chainId) ? data.chainId : CHAIN_IDS[chain],
      release: false,
    };
  }
  const onChain = Boolean(data?.txHash || data?.tokenAddress);
  if (data !== null && !onChain && res.status >= 400 && res.status < 500) {
    // A 4xx with a parsed body is tokens.fun refusing before minting: safe to release.
    if (res.status === 429) return { status: 'failed', note: walletLimitNote(retryAt), release: true };
    const said =
      data?.message ?? data?.error ?? `tokens.fun returned ${res.status}`;
    return { status: 'failed', note: `Token not launched: ${said}`, release: true };
  }
  const preMint =
    data !== null && !onChain && (data.minted === false || (res.status === 503 && knownPreMint503(data.error)));
  if (preMint)
    return {
      status: 'failed',
      note: NOT_LAUNCHED_YET,
      release: true,
      retry: true,
      ...(typeof data?.error === 'string' && data.error.startsWith(PENDING_TX) && { busy: true as const }),
    };
  // Any other 5xx, an unparsed body, or a 2xx that didn't confirm success: tokens.fun didn't
  // clearly say the launch failed, so keep the claim and let the builder check before retrying.
  return {
    status: 'pending',
    note: LAUNCH_STUCK,
    agent_note: launchStuckAgent(`tokens.fun couldn't confirm the launch (it returned ${res.status}).`),
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

/** v2.8.1 §A1: a launch claim older than this is stuck: the cron puts it in needs_owner. */
export const STUCK_LAUNCH_MS = 10 * 60_000;

/**
 * v2.8.1 §A1: the projects whose launch claim (`token_url = 'pending'`) is older than 10 minutes
 * (claims from before v2.8.1 got the migration's time, schema.sql; a claim with no time, taken by old
 * code after the migration, counts too), oldest first. The owner checks each
 * with the "token stuck in pending" runbook; EarnKit never releases one on a guess.
 */
export async function stuckLaunches(now: Date): Promise<number[]> {
  const rows = await sql()<{ id: number }[]>`
    SELECT id FROM projects
    WHERE token_url = 'pending'
      AND (token_claimed_at IS NULL OR token_claimed_at < ${new Date(now.getTime() - STUCK_LAUNCH_MS)})
    ORDER BY token_claimed_at NULLS FIRST, id`;
  return rows.map((r) => r.id);
}

/**
 * v2.8.1 §A1: the project's token state now (read again, so a launch that settled since an earlier
 * read is reported as it is): its link or 'pending', when the claim was taken, whether a pending
 * deploy already answered without a clear result (a note is written then; a running one has none),
 * and its note.
 */
export async function launchClaimedAt(
  projectId: number,
): Promise<{ token_url: string | null; claimedAt: Date | null; settled: boolean; note: string | null }> {
  const [row] = await sql()<{ token_url: string | null; token_claimed_at: Date | null; token_note: string | null }[]>`
    SELECT token_url, token_claimed_at, token_note FROM projects WHERE id = ${projectId}`;
  return {
    token_url: row?.token_url ?? null,
    claimedAt: row?.token_claimed_at ?? null,
    settled: row?.token_url === 'pending' && Boolean(row?.token_note),
    note: row?.token_note ?? null,
  };
}

/**
 * Whether a pending launch claimed at `claimedAt` is past STUCK_LAUNCH_MS. Final fix wave (M1): a
 * pending claim with no time (taken by pre-v2.8.1 code after the migration's backfill) counts as
 * stuck, so it never shows "launching" forever. Pure.
 */
export const launchStuck = (claimedAt: Date | string | null | undefined, now = new Date()) =>
  claimedAt == null || now.getTime() - new Date(claimedAt).getTime() > STUCK_LAUNCH_MS;

/** v2.8.1 §A1: the pause before the one automatic retry of a launch tokens.fun refused before minting. */
export const RETRY_PAUSE_MS = 3_000;
/** Longer when its gas wallet was busy: it had already waited up to 30 s for that to clear. */
export const BUSY_RETRY_PAUSE_MS = 10_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Whether token launches are configured on this deployment (the tokens.fun deploy key is set). */
export const tokenLaunchesAvailable = () =>
  Boolean(process.env.TOKENSFUN_DEPLOY_API_KEY);

export const TOKENS_UNAVAILABLE = "Token launches aren't available right now.";

/** The claim found the project's links changed after the gate checked them. */
export const LINKS_CHANGED =
  "The project's links changed during the launch (nothing was launched); say 'launch the token' to try again.";

/** The claim matched nothing although the project had no token: something changed meanwhile. */
export const STATE_CHANGED =
  "The project changed during the launch (nothing was launched); say 'launch the token' to try again.";

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
 * v2.5 Ruling 25: the program each of these normalized repos already has its coin entered in (the
 * earliest EarnKit launch claim, launched or pending), by repo key. One coin per repo (v2.3), so
 * an entry of the same repo in another program gets no coin and no builder bonus.
 */
export async function repoCoinPrograms(repoKeys: string[]): Promise<Map<string, { program_id: string; title: string }>> {
  if (repoKeys.length === 0) return new Map();
  const rows = await sql()<{ key: string; program_id: string; title: string; kind: string | null }[]>`
    SELECT DISTINCT ON (p.token_repo_key) p.token_repo_key AS key, p.program_id, g.title, g.campaign->>'kind' AS kind
    FROM projects p JOIN programs g ON g.id = p.program_id
    WHERE p.token_repo_key IN ${sql()(repoKeys)} AND p.token_url IS NOT NULL
    ORDER BY p.token_repo_key, p.id`;
  // A sponsor campaign's title is the sponsor's text: quoted, as everywhere else.
  return new Map(rows.map((r) => [r.key, { program_id: r.program_id, title: r.kind === 'sponsor' ? quoted(r.title) : r.title }]));
}

/** tokens.fun's description cap (v2.10 item 11). */
const TOKEN_DESCRIPTION_MAX = 280;

/** Cut to `max` characters at a word boundary. Pure. */
const cutAtWord = (s: string, max: number) => {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const space = head.search(/\s\S*$/);
  return (space > 0 ? head.slice(0, space) : s.slice(0, max)).trimEnd();
};

/**
 * v2.10 item 11: the description sent to tokens.fun, in plain words and at most 280 characters: the
 * project's description, else its one-liner, else "<Name> on <Chain>" (final fix I1, ledger c2: the
 * chain is the entry's program's, when the program names exactly one known chain; an any-chain or
 * multi-chain program gets "<Name>" alone, so a project is never said to be on a chain it isn't on).
 * A text with an address, hash, stat list or link (`plainProblem`) is never sent. Pure.
 */
export function tokenDescription(p: {
  name: string;
  description: string | null;
  one_liner?: string | null;
  /** The entry's program's chains (`programs.chains`). */
  chains?: readonly string[] | null;
}): string {
  for (const text of [p.description, p.one_liner]) {
    const t = text?.replace(/\s+/g, ' ').trim();
    if (t && !plainProblem(t, 'one_liner')) return cutAtWord(t, TOKEN_DESCRIPTION_MAX);
  }
  const only = p.chains?.length === 1 ? p.chains[0] : null;
  const chain = only && Object.hasOwn(CHAIN_NAMES, only) ? CHAIN_NAMES[only as Chain] : null;
  return cutAtWord(chain ? `${p.name} on ${chain}` : p.name, TOKEN_DESCRIPTION_MAX);
}

/** The entry's one-liner answer (the stored application's `one_liner` field), or null. Pure. */
const oneLinerOf = (app: Application | null): string | null => {
  const key = app && Object.keys(app.kinds ?? {}).find((k) => app.kinds[k] === 'one_liner');
  return key && typeof app.answers?.[key] === 'string' ? app.answers[key] : null;
};

/**
 * Launches a token for a submitted project on tokens.fun: claims the project (and, v2.8.1, stamps
 * token_claimed_at for the cron's stuck-launch alert), resolves the image, POSTs the deploy, and
 * records the outcome. The claim (`token_url = 'pending'`) is set first and released ONLY when
 * tokens.fun said in a parsed JSON body, with no tx hash or token address, that it stopped before
 * minting (outcomeOf: a 4xx, a 503, a revert). A refusal of that kind that isn't the builder's
 * (a 503 or a revert, v2.8.1 §A1) is retried once at once, under the same claim. Any other outcome
 * (no response, another 5xx, a body that didn't parse) keeps the claim pending, since tokens.fun
 * may have minted anyway and a retry must not risk a second, permanent token.
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
    chain?: LaunchChain;
    /**
     * The repo and live links the gate checked. The claim only matches while the row still holds
     * exactly these, token_repo_key comes from the repo here (never a re-read), and tokens.fun's
     * metadata uses them.
     */
    repoUrl: string | null;
    liveUrl: string | null;
    /**
     * v2.10 R10 (Pre-flight P4): the gate read the repo through the read-only App (it isn't public):
     * the entry is marked repo_private with the claim, and tokens.fun never gets the repo URL.
     */
    repoPrivate?: boolean;
    /**
     * v2.8.1 fix round 1: true once the tool already replied "launching" (the flow runs on). A release
     * then is stamped token_released_at, so the agent's check-back reads it instead of relaunching.
     */
    background?: () => boolean;
  },
  deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
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
      `No project ${a.projectId} recorded by you. Pass the entry's project_id; a sent application is recorded with tell program_status applied.`,
    );
  const repoKey = a.repoUrl ? normalizeRepoUrl(a.repoUrl) : null;
  if (repoKey) {
    const other = await repoTokenUrl(a.projectId, repoKey);
    if (other) return { status: 'failed', note: repoHasTokenNote(other) };
  }

  // Claim the project atomically: only this installation's project, only if it has no token yet (and v2.8 Ruling 3, was never confirmed with "skip"),
  // only while its links are still the ones the gate checked (launch_token can change them), only
  // if no other project on its repo has one. The claim (token_url = 'pending') is released
  // ONLY when tokens.fun said it stopped before minting; every other outcome keeps it (outcomeOf).
  let claimed;
  try {
    claimed = await sql()<
      {
        name: string;
        description: string | null;
        application: Application | null;
        repo_url: string | null;
        live_url: string | null;
        repo_private: boolean;
        program_chains: string[] | null;
      }[]
    >`
    UPDATE projects SET token_url = 'pending', token_status = 'pending', token_note = NULL, token_claimed_at = now(), token_released_at = NULL,
      token_name = ${a.name}, token_symbol = ${a.symbol}, token_repo_key = ${repoKey},
      token_image = ${a.image?.bytes ?? null}, token_image_type = ${a.image?.type ?? null},
      repo_private = repo_private OR ${a.repoPrivate === true}
    WHERE id = ${a.projectId} AND installation_id = ${a.installationId} AND token_url IS NULL
      AND confirm_choice IS DISTINCT FROM 'skip'
      AND repo_url IS NOT DISTINCT FROM ${a.repoUrl}::text
      AND live_url IS NOT DISTINCT FROM ${a.liveUrl}::text
      AND (${repoKey}::text IS NULL OR NOT EXISTS (
        SELECT 1 FROM projects o
        WHERE o.token_repo_key = ${repoKey} AND o.token_url IS NOT NULL AND o.id <> ${a.projectId}))
    RETURNING name, description, application, repo_url, live_url, repo_private,
      (SELECT g.chains FROM programs g WHERE g.id = projects.program_id) AS program_chains`;
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
        `No project ${a.projectId} recorded by you. Pass the entry's project_id; a sent application is recorded with tell program_status applied.`,
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
    // v2.8.1 §A5: this project's own launch, claimed by another call a moment ago: launching.
    return existing.token_url === 'pending'
      ? { status: 'pending', note: LAUNCHING, agent_note: LAUNCHING_AGENT, launching: true }
      : { status: 'failed', note: `This project already has a token: ${existing.token_url}` };
  }

  // Ruling H7: a refused agent link falls back to the generated mark.
  const agentUrl = a.imageUrl && !unsafeImageUrl(a.imageUrl) ? a.imageUrl : undefined;
  if (a.imageUrl && !agentUrl) console.error(`[launch] project ${a.projectId}: image_url refused (may carry a secret); sending the mark`);
  const imageUrl = a.image
    ? `${origin}/api/projects/${a.projectId}/image`
    : (agentUrl ??
      // v2.10 item 12: the generated mark (shape and gradient from the id, no letters); never the
      // text tile. Stable: the same id always draws the same mark, so the onchain link never changes.
      `${origin}/api/projects/${a.projectId}/mark`);
  // v2.10 R10: a private repo's URL never goes to tokens.fun; the live link only.
  const website = a.liveUrl ?? (project.repo_private ? undefined : a.repoUrl) ?? undefined;
  const doFetch = deps.fetch ?? fetch;

  // EARNKIT_TOKENSFUN_TIMEOUT_MS bounds the deploy fetch (default 120s); a later e2e lowers it
  // to exercise the pending (no-response) path without waiting out the real timeout. Parsed once,
  // and only used if it's a positive integer — an unset, blank, or malformed value (NaN from '')
  // must not collapse the timeout to 0 and abort instantly.
  const rawTimeoutMs = Number(process.env.EARNKIT_TOKENSFUN_TIMEOUT_MS);
  const timeoutMs =
    Number.isInteger(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 120_000;

  const body = JSON.stringify({
    name: a.name,
    symbol: a.symbol,
    creatorWallet: a.creatorWallet,
    tokenURI: imageUrl,
    imageUrl,
    description: tokenDescription({ name: project.name, description: project.description, one_liner: oneLinerOf(project.application), chains: project.program_chains }),
    ...(website && { website, appUrl: a.liveUrl ?? undefined }),
    ...(twitter && { twitter }),
    chainId: CHAIN_IDS[chain],
    source: 'earnkit',
    tokenSource: 'external',
  });
  const post = async () => {
    try {
      const res = await doFetch(`${tokensFunUrl()}/api/v1/deploy`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = (await res.json().catch(() => null)) as DeployResponse | null;
      return outcomeOf(
        { ok: res.ok, status: res.status },
        data && typeof data === 'object' ? data : null,
        chain,
        retryAtOf(data, res.headers.get('retry-after'), new Date()),
      );
    } catch {
      return outcomeOf(null, null, chain);
    }
  };

  // v2.8.1 §A1: tokens.fun said nothing was minted (a 503 such as "Pending transactions detected"
  // on its one gas wallet, or a revert): one automatic retry while the claim is still held, after a
  // short pause. Never for an outcome that may have minted (those keep the claim, see outcomeOf).
  let result = await post();
  if (result.retry) {
    await (deps.sleep ?? sleep)(result.busy ? BUSY_RETRY_PAUSE_MS : RETRY_PAUSE_MS);
    result = await post();
  }
  const { release, retry: _retry, busy: _busy, chain_id: chainId, ...outcome } = result;

  if (release) {
    await sql()`
      UPDATE projects SET token_url = NULL, token_status = 'failed', token_note = ${outcome.note ?? null},
        token_released_at = ${a.background?.() ? new Date() : null}
      WHERE id = ${a.projectId} AND token_url = 'pending'`;
  } else if (outcome.status === 'launched') {
    // Logged first: if the write below fails, the owner still has the token to record by hand.
    console.log(`[launch] project ${a.projectId}: launched ${outcome.token_address ?? '?'} (tx ${outcome.tx_hash ?? '?'})`);
    // v2.5: the coin's address, which the builder bonus ledger attributes fee deposits by, written
    // with the launch (M9: one statement). Base only (Ruling 24: tokens.fun gives other chains the
    // pre-v2.5 split, with no builder bonus slot). coin_launched_at: an entry counts in a round
    // only if launched before its end (Ruling 16).
    const coin = chain === 'base' && outcome.token_address && /^0x[0-9a-fA-F]{40}$/.test(outcome.token_address)
      ? outcome.token_address.toLowerCase()
      : null;
    // v2.13 T9: the launch's tx and chain (internal).
    const launched = (withCoin: boolean) => sql()`
      UPDATE projects SET token_url = ${outcome.tokens_fun ?? null}, token_status = 'launched', token_note = NULL,
        coin_tx = ${outcome.tx_hash ?? null}, coin_chain_id = ${chainId ?? CHAIN_IDS[chain]}
        ${withCoin ? sql()`, coin_address = ${coin}, coin_launched_at = COALESCE(coin_launched_at, now())` : sql()``}
      WHERE id = ${a.projectId}`;
    try {
      await launched(coin !== null);
    } catch (err) {
      // Only a duplicate coin address (the unique index) is tolerated: logged, and the launch is
      // still recorded without it. Any other error is the launch write failing: thrown.
      if (coin === null || (err as { code?: string }).code !== '23505') throw err;
      console.error(`[launch] project ${a.projectId}: token ${coin} not recorded for the builder bonus (already on another entry)`);
      await launched(false);
    }
  } else {
    // pending: token_url stays 'pending' from the claim above; only the note changes.
    await sql()`UPDATE projects SET token_note = ${outcome.note ?? null} WHERE id = ${a.projectId}`;
  }

  return { ...outcome, name: a.name, symbol: a.symbol };
}
