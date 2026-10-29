import { sql } from './db';
import { builderToken, tradeUrl, type BuilderToken } from './builder-token';
import { allTimeCommunityUsd } from './community';
import { siteUrl, shortWallet } from './entry-text';
import { usd } from './campaigns';
import { TOKEN_ON_ITS_WAY } from './bench-reply';
import { provenWallet, walletLink } from './wallet-proof';

const logged = (where: string) => (err: unknown) => {
  console.error(`[token answers] ${where}`, err instanceof Error ? err.name : 'error');
};

/**
 * v4.2 Task 1: what a builder is told about their token when they ask, in each state. Pure text in tokenAnswerText;
 * tokenAnswerFor reads the state. Never "coin", never a pitch when the token is live, never a bare status line.
 */
export const TOKEN_EXPLAINER =
  "Your token is how people who believe in your work can back it. Anyone can trade it, and 40% of every trade's fee goes to your wallet, claimed for you. It lives on Base, whatever chain you build on.";
/** v4.0: an open step 3 that showed the token sentence (standing_seen.token_offered; builders mid-flow keep it). */
export const TOKEN_GOES_LIVE_ON_SIGN = 'It goes live when you sign. Rather skip it? Just say no.';
/** v4.4: an open step 3 asks for the wallet only; the token is said as a statement (its offer follows the sign). */
export const TOKEN_AFTER_WALLET = 'You can turn it on once your wallet is added.';
/** Final review 2: a statement, no question (a yes to it would answer nothing). */
export const TOKEN_OFF = 'Your token is off. Say launch my token anytime to turn it on.';
export const tokenSignLine = (link: string) => `Sign with your wallet and it goes live: ${link}`;
/** v4.4: the state text for a token the builder already had (builder_tokens status 'existing'). Pure. */
export const existingTokenText = (coin: string) => `Your token is ${shortWallet(coin.toLowerCase())}. EarnKit didn't launch it, so its fees aren't claimed here.`;
/** The just-launched reply's page line. Pure. */
export const tokenPageLine = (handle: string) => `It's on your page too: ${siteUrl()}/${handle}`;

export type TokenAnswerState = {
  token: Pick<BuilderToken, 'status' | 'symbol' | 'coin_address' | 'wallet'> | null;
  /** The builder's X handle (their page: earnkit.com/<handle>). */
  handle: string | null;
  /** Everything the community has sent to the token's wallet, in USD (0: none or unknown). */
  communityUsd: number;
  /** Setup step 3 is open: the wallet question was asked and not answered. */
  walletStepOpen: boolean;
  /** v4.0: the builder was shown step 3's token sentence (standing_seen.token_offered): the sign launches it. */
  tokenOffered?: boolean;
  /** A fresh wallet signing link, when there is no proven wallet (null: none can be made). */
  signLink: string | null;
  /** A reward wallet is proven. */
  hasWallet: boolean;
};
export type TokenAnswerOpts = {
  /** Just launched (tell yes, a legacy yes, or the wallet sign): "Done." and the page. */
  justLaunched?: boolean;
  /**
   * The seam for the wallet-but-no-offer state (no token, wallet proven, nothing asked): Task 6's offer question,
   * appended to the explainer. Null: the explainer alone.
   */
  offerQuestion?: string | null;
};

/** The reply for a builder's token question in this state (a launched row with no address yet reads as on its way). Pure. */
export function tokenAnswerText(s: TokenAnswerState, opts: TokenAnswerOpts = {}): string {
  const t = s.token;
  if (t?.status === 'declined') return TOKEN_OFF;
  if (t?.status === 'launched' && t.coin_address) {
    const trade = tradeUrl(t.coin_address);
    if (opts.justLaunched) return [`Done. Your token is live: ${trade}`, s.handle ? tokenPageLine(s.handle) : null].filter(Boolean).join('\n');
    return [
      `Your token is live: ${trade}`,
      t.wallet ? `40% of every trade's fee goes to ${shortWallet(t.wallet)}, claimed for you.` : `40% of every trade's fee goes to your wallet, claimed for you.`,
      s.communityUsd > 0 ? `So far: ${usd(s.communityUsd)}.` : null,
    ].filter(Boolean).join('\n');
  }
  // v4.4: the builder's own token, named (recordExistingToken): never claimed here.
  if (t?.status === 'existing' && t.coin_address) return existingTokenText(t.coin_address);
  if (t) return TOKEN_ON_ITS_WAY;
  if (s.walletStepOpen) return `${TOKEN_EXPLAINER}\n\n${s.tokenOffered ? TOKEN_GOES_LIVE_ON_SIGN : TOKEN_AFTER_WALLET}`;
  if (!s.hasWallet) return s.signLink ? `${TOKEN_EXPLAINER}\n\n${tokenSignLine(s.signLink)}` : TOKEN_EXPLAINER;
  return opts.offerQuestion ? `${TOKEN_EXPLAINER}\n\n${opts.offerQuestion}` : TOKEN_EXPLAINER;
}

/** Reads the builder's token state. Throws on a database error (callers catch). */
export async function tokenAnswerState(builderId: number, now: Date, token?: BuilderToken | null): Promise<TokenAnswerState> {
  const row = token === undefined ? await builderToken(builderId) : token;
  const [p] = await sql()<{ handle: string | null; step: boolean; offered: boolean }[]>`
    SELECT x_handle AS handle, COALESCE(standing_seen ? 'wallet_setup', false) AS step, COALESCE(standing_seen ? 'token_offered', false) AS offered
    FROM builder_profiles WHERE builder_id = ${builderId}`;
  const wallet = await provenWallet(builderId);
  const communityUsd = row?.status === 'launched' ? await allTimeCommunityUsd(builderId).catch((err: unknown) => (logged('community')(err), 0)) : 0;
  return {
    token: row,
    handle: p?.handle ?? null,
    communityUsd,
    walletStepOpen: !wallet && p?.step === true,
    tokenOffered: p?.offered === true,
    signLink: wallet || row ? null : walletLink(builderId, now),
    hasWallet: Boolean(wallet),
  };
}

/** tokenAnswerText for a builder, read fresh. Throws on a database error. */
export async function tokenAnswerFor(builderId: number, now: Date, opts: TokenAnswerOpts = {}): Promise<string> {
  return tokenAnswerText(await tokenAnswerState(builderId, now), opts);
}
