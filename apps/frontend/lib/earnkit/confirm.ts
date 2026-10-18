import { SKIP_TOKEN, shortWallet } from './entry-text';

export { SKIP_TOKEN };

/**
 * v2.8 Part C, Rulings 4, 5, 7 and 31 (plan): the confirmation step. v2.10 item 5: the token is
 * pitched once, here, as one line inside the single yes ("Yes submits your entry and launches
 * $TIP (Tip Jar): 40% of its fees to you. yes / skip the token"); "skip the
 * token" submits without one. Pure: the offer text and the decision only.
 */

export type OfferInput = {
  /** v2.6 Ruling 25: the program this repo's token is entered in, or null. */
  coinIn: string | null;
  canPush: boolean;
  /**
   * v2.9 B9 (Pre-flight P9): GitHub sign-in is on, so an agent that can't push still gets the token
   * offer (the builder signs in after "yes"). Off: the CANT_PUSH line, as before.
   */
  signIn?: boolean;
  /** The wallet shown (given, the entry's own, or remembered on a non-shared client), or null: asked. */
  wallet: string | null;
  /** No token on this entry at all (the program's token policy is off, or launches are unavailable). */
  tokensOff?: boolean;
  /** v2.8.1 §A2: the token that launches on "yes", named in the Yes line. */
  proposal?: { name: string; symbol: string } | null;
  /**
   * v2.8.1 §F19 (T7 journey test): the offer again in the same entry (a taken ticker, or a pair the
   * builder hasn't seen): the line names the token without the earnings figure, said once already.
   */
  again?: boolean;
  /**
   * v2.12 spec 7 (R22), v2.12.1 T10: no token line here: the token is not pitched for this entry
   * (coin-moments.ts coinPitchAllowed: with the flag on, only the build path's and the coin's own).
   */
  belowScore?: boolean;
};

export const NO_WALLET_HINT = 'No wallet? Make one at keys.coinbase.com, then send me the address.';
/** Only for an agent that said it can't push (agent.can_push: false); never after a proof-line miss. */
export const CANT_PUSH = 'To launch your token, open this in Claude Code or Cursor.';
/**
 * v2.8.1 §A3: the proof line still isn't on the repo after a second "go" (an agent that can push).
 * The entry is saved with the kit and the launch stays open: "go" again launches it.
 */
export const proofLineWaiting = (branch?: string | null) =>
  `Your entry is saved. Your token is waiting on a short proof line on your repo's ${branch ? `${branch} branch` : 'default branch'}; say go once I've pushed it.`;
export const READY_TO_SUBMIT = 'Ready to submit?';
/** Ruling 4 (plan): a `go` on an entry with no repo to prove. */
export const NEEDS_REPO = 'Your token needs a public repo.';
/** Ruling 4 (plan): a `go` on a program without tokens, or while launches are unavailable. */
export const NO_TOKEN_HERE = 'No token for this entry.';

/**
 * Review Minor 5: after a "yes" that came without the wallet it showed, the question about the
 * wallet shown (short), so the builder confirms it in one word. Pure.
 */
export const walletQuestion = (wallet: string) => `Use ${shortWallet(wallet.toLowerCase())} for fees, or tell me another?`;

/** Review Minor 8: confirm_entry's builder line when a fixable problem has no note. */
export const TOKEN_ERROR_CONFIRM = 'EarnKit hit an error launching the token; say go to try again.';

/**
 * v2.10 item 5: the one pitch, inside the single yes, once per entry flow: "Yes submits your entry
 * and launches $TIP (Tip Jar): 40% of its fees to you. Wallet: 0x12ab…9f3e. yes / skip the token".
 * `again` (said once already) drops the earnings part. The wallet is shown short when known (on a shared client only
 * one given in this flow, G13), else asked in the same line. Pure.
 */
export function confirmLine(a: {
  proposal: { name: string; symbol: string } | null;
  wallet: string | null;
  walletKnown: boolean;
  again?: boolean;
}): string {
  const what = a.proposal ? `$${a.proposal.symbol} (${a.proposal.name})` : 'your token';
  const why = a.again ? '' : ': 40% of its fees to you';
  const answer = a.walletKnown
    ? `${a.wallet ? `Wallet: ${shortWallet(a.wallet.toLowerCase())}. ` : ''}yes / ${SKIP_TOKEN}`
    : `Say yes with your wallet address / ${SKIP_TOKEN}`;
  return `Yes submits your entry and launches ${what}${why}. ${answer}`;
}

/**
 * The confirmation offer the builder answers with one word: the confirm line. v2.8.1 §C13: a repo
 * whose token is in another program, or an entry without a token, gets "Ready to submit?" alone.
 * Pure.
 */
export function confirmOffer(a: OfferInput): string {
  if (a.coinIn) return READY_TO_SUBMIT;
  if (a.belowScore) return READY_TO_SUBMIT;
  if (a.tokensOff) return READY_TO_SUBMIT;
  if (!a.canPush && !a.signIn) return `${CANT_PUSH}\n${READY_TO_SUBMIT}`;
  return confirmLine({ proposal: a.proposal ?? null, wallet: a.wallet, walletKnown: a.wallet !== null, again: a.again });
}

export type ConfirmDecision =
  | { kind: 'offer' } // not confirmed yet: show the offer
  | { kind: 'skip' }
  | { kind: 'record_only'; note: string } // lasting reason: no token, kit returned ('' : nothing to say)
  | { kind: 'launch' }
  // v2.9 B9: an agent that can't push, with GitHub sign-in on: the builder signs in, then it launches.
  | { kind: 'sign_in' };

/**
 * v2.9 B9: the builder's one line with the sign-in link: "One click to prove TipJar is yours, then
 * $TIP launches: <link>". Pure.
 */
export const signInLine = (project: string, symbol: string | null, link: string) =>
  `One click to prove ${project} is yours, then ${symbol ? `$${symbol}` : 'your token'} launches: ${link}`;

/** What a confirm_entry call does (Ruling 4 (plan)). Pure. */
export function confirmDecision(a: {
  confirmed: boolean;
  decision?: 'go' | 'skip';
  coinIn: string | null;
  canPush: boolean;
  hasRepo: boolean;
  policyOff: boolean;
  available: boolean;
  /** v2.9 B9: GitHub sign-in is on (githubVerifyEnabled). */
  signIn?: boolean;
  /** v2.12 spec 7 (R22), v2.12.1 T10: no token pitched for this entry: a yes records the entry, no token. */
  belowScore?: boolean;
}): ConfirmDecision {
  if (!a.confirmed || !a.decision) return { kind: 'offer' };
  if (a.decision === 'skip') return { kind: 'skip' };
  if (a.belowScore) return { kind: 'record_only', note: '' };
  // v2.8.1 §C13: the repo's token is in another program: the kit alone, no bonus note.
  if (a.coinIn) return { kind: 'record_only', note: '' };
  if (!a.canPush && !a.signIn) return { kind: 'record_only', note: CANT_PUSH };
  if (!a.hasRepo) return { kind: 'record_only', note: NEEDS_REPO };
  if (a.policyOff || !a.available) return { kind: 'record_only', note: NO_TOKEN_HERE };
  return a.canPush ? { kind: 'launch' } : { kind: 'sign_in' };
}
