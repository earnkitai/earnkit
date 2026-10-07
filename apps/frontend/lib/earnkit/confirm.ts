import { COIN_FOOTNOTE, bonusCountsIn, shortWallet } from './entry-text';

export { bonusCountsIn };

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
};

export const NO_WALLET_HINT = 'No wallet? Make one at keys.coinbase.com, then send me the address.';
export const CANT_PUSH = 'To launch your token, open this in Claude Code or Cursor.';
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

/** The confirmation offer the builder answers with one word. Pure. */
export function confirmOffer(a: OfferInput): string {
  if (a.coinIn) return `${bonusCountsIn(a.coinIn)}\n${READY_TO_SUBMIT}`;
  if (a.tokensOff) return READY_TO_SUBMIT;
  if (!a.canPush) return `${CANT_PUSH}\n${READY_TO_SUBMIT}`;
  const wallet = offerWalletLine(a);
  const lines = a.hasBonus
    ? [
        'Want the builder bonus? It comes with a token.',
        'Yes: your entry gets a token on Base. You earn 40% of its trading fees and compete for the builder bonus (top 10 on each program, paid in ETH).',
        SKIP_LINE,
        wallet,
      ]
    : ['Want a token for your entry? It earns you 40% of its trading fees.', 'Yes: your entry gets a token on Base.', 'Skip: no token.', wallet];
  return `${lines.join('\n')}\n\n${COIN_FOOTNOTE}`;
}

export type ConfirmDecision =
  | { kind: 'offer' } // not confirmed yet: show the offer
  | { kind: 'skip' }
  | { kind: 'record_only'; note: string } // lasting reason: no token, kit returned
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
  if (a.coinIn) return { kind: 'record_only', note: bonusCountsIn(a.coinIn) };
  if (!a.canPush) return { kind: 'record_only', note: CANT_PUSH };
  if (!a.hasRepo) return { kind: 'record_only', note: NEEDS_REPO };
  if (a.policyOff || !a.available) return { kind: 'record_only', note: NO_TOKEN_HERE };
  return { kind: 'launch' };
}
