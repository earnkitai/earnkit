import { COIN_FOOTNOTE, bonusRidesOn, shortWallet } from './entry-text';

export { bonusRidesOn };

/**
 * v2.8 Part C, Rulings 4, 5, 7 and 31 (plan): the confirmation step. One combined offer (the builder
 * bonus comes with a token) replaces the separate token row; "yes" launches the token, "skip" means
 * no token and no builder bonus. Pure: the offer text and the decision only.
 */

export type OfferInput = {
  hasBonus: boolean;
  /** v2.6 Ruling 25: the program this repo's token is entered in, or null. */
  coinIn: string | null;
  canPush: boolean;
  wallet: string | null;
  remembered: boolean;
  /** No token on this entry at all (the program's token policy is off, or launches are unavailable). */
  tokensOff?: boolean;
  /** v2.8.1 §A2: the token that launches on "yes", named in the Yes line. */
  proposal?: { name: string; symbol: string } | null;
  /**
   * v2.8.1 §F19 (T7 journey test): the offer again in the same entry (a taken ticker, or a pair the
   * builder hasn't seen): the Yes line names the token without the earnings figure, said once already.
   */
  again?: boolean;
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
export const SKIP_LINE = 'Skip: no token, no builder bonus.';
export const READY_TO_SUBMIT = 'Ready to submit?';
/** Ruling 4 (plan): a `go` on an entry with no repo to prove. */
export const NEEDS_REPO = 'Your token needs a public repo.';
/** Ruling 4 (plan): a `go` on a program without tokens, or while launches are unavailable. */
export const NO_TOKEN_HERE = 'No token for this entry.';

/** The wallet line of the offer (Ruling 17's form): short, lowercase, or the no-wallet hint. Pure. */
export function offerWalletLine(a: { wallet: string | null; remembered: boolean; hasBonus: boolean }) {
  const what = a.hasBonus ? 'fees and any bonus' : 'fees';
  return a.wallet
    ? `Wallet for ${what}: ${shortWallet(a.wallet.toLowerCase())}${a.remembered ? ' (used last time)' : ''}, or tell me another.`
    : `Wallet for ${what}: none yet. ${NO_WALLET_HINT}`;
}

/**
 * Review Minor 5: after a "yes" that came without the wallet it showed, the question about the
 * wallet shown (short), so the builder confirms it in one word. Pure.
 */
export const walletQuestion = (wallet: string, hasBonus: boolean) =>
  `Use ${shortWallet(wallet.toLowerCase())} for ${hasBonus ? 'fees and any bonus' : 'fees'}, or tell me another?`;

/** Review Minor 8: confirm_entry's builder line when a fixable problem has no note. */
export const TOKEN_ERROR_CONFIRM = 'EarnKit hit an error launching the token; say go to try again.';

/**
 * v2.8.1 §A2, §F19: the Yes line names the token that launches, and is the one place an entry's flow
 * says "40%": "Yes: launches $TIP (TipJar) on Base. You earn 40% of its trading fees, plus a shot at
 * the builder bonus." Pure; exported for tests.
 */
export function yesLine(proposal: { name: string; symbol: string } | null, hasBonus: boolean, again = false) {
  const what = proposal ? `launches $${proposal.symbol} (${proposal.name}) on Base` : 'your entry gets a token on Base';
  if (again) return `Yes: ${what}.`;
  return `Yes: ${what}. You earn 40% of its trading fees${hasBonus ? ', plus a shot at the builder bonus' : ''}.`;
}

/**
 * The confirmation offer the builder answers with one word. v2.8.1 §C13: a repo whose token is in
 * another program gets "Ready to submit?" alone (the bonus note is said once, in Also qualifies).
 * Pure.
 */
export function confirmOffer(a: OfferInput): string {
  if (a.coinIn) return READY_TO_SUBMIT;
  if (a.tokensOff) return READY_TO_SUBMIT;
  if (!a.canPush) return `${CANT_PUSH}\n${READY_TO_SUBMIT}`;
  const wallet = offerWalletLine(a);
  const lines = a.hasBonus
    ? ['Want the builder bonus? It comes with a token.', yesLine(a.proposal ?? null, true, a.again), SKIP_LINE, wallet]
    : ['Want a token for your entry?', yesLine(a.proposal ?? null, false, a.again), 'Skip: no token.', wallet];
  return `${lines.join('\n')}\n\n${COIN_FOOTNOTE}`;
}

export type ConfirmDecision =
  | { kind: 'offer' } // not confirmed yet: show the offer
  | { kind: 'skip' }
  | { kind: 'record_only'; note: string } // lasting reason: no token, kit returned ('' : nothing to say)
  | { kind: 'launch' };

/** What a confirm_entry call does (Ruling 4 (plan)). Pure. */
export function confirmDecision(a: {
  confirmed: boolean;
  decision?: 'go' | 'skip';
  coinIn: string | null;
  canPush: boolean;
  hasRepo: boolean;
  policyOff: boolean;
  available: boolean;
}): ConfirmDecision {
  if (!a.confirmed || !a.decision) return { kind: 'offer' };
  if (a.decision === 'skip') return { kind: 'skip' };
  // v2.8.1 §C13: the repo's token is in another program: the kit alone, no bonus note.
  if (a.coinIn) return { kind: 'record_only', note: '' };
  if (!a.canPush) return { kind: 'record_only', note: CANT_PUSH };
  if (!a.hasRepo) return { kind: 'record_only', note: NEEDS_REPO };
  if (a.policyOff || !a.available) return { kind: 'record_only', note: NO_TOKEN_HERE };
  return { kind: 'launch' };
}
