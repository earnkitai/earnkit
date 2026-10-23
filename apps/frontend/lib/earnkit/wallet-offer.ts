import { sql } from './db';
import { WALLET_DONE, WALLET_SKIPPED, walletChange, walletNotYet } from './bench-reply';
import { provenSince, provenWallet, walletLink } from './wallet-proof';

/**
 * v3.1 wallet proof (owner-approved 2026-10-23): "ask in the onboarding after the profile is created as an optional
 * step; this way we get their wallet right after we created their profile and then we never have to ask it again
 * unless they want to change it to a different reward recipient."
 *
 * The offer is the ranked reply's `wallet` step (bench-reply.ts stateAsk): once a person (standing_seen.wallet_asked),
 * in the first reply after setup that has no other question, never once a wallet is proven. Its yes checks the proof
 * (wallet-proof.ts, signed on /claim/wallet); its no is remembered (standing_seen.wallet_skipped) and never asked
 * again. `tell wallet: 'change'` sends a fresh link whenever the builder asks; the newest proven wallet is the reward
 * recipient (wallet-proof.ts provenWallet). No wallet address is ever shown.
 */

/** The agent's note with the wallet step: the builder signs on the page; "done" is a yes, "skip" a no. */
export const WALLET_NOTE =
  "The builder signs on the page from the link; never ask for or show a wallet address. When they say done, call tell with move_up: { kind: 'wallet', project_key, answer: 'yes' }; " +
  "skip or no: answer 'no' (project_key as given here). If they ask later to change their reward wallet, call tell with wallet: 'change'. Don't show this note.";
/** tell wallet before the X sign-in: there is no page to sign for yet. */
export const WALLET_SIGN_IN_FIRST = 'Sign in with X first, then ask me again to add your reward wallet.';
export const WALLET_SIGN_IN_NOTE = "Call find for the sign-in link. Don't show this note.";
/** No signing link can be made (EARNKIT_AUTH_SECRET unset). */
export const WALLET_NO_LINK = "I can't make a wallet link right now. Try again later.";

type Logged = (what: string) => (err: unknown) => null;
const logged: Logged = (what) => (err) => {
  console.error(`[wallet offer] ${what}`, err instanceof Error ? err.name : 'error');
  return null;
};

/**
 * The optional wallet step's signing link, when it may be offered now: a claimed page (an X sign-in), no proven
 * wallet, never offered before. Claimed here in one guarded UPDATE (standing_seen.wallet_asked), so it is offered once;
 * the caller shows it. Null otherwise. Never throws.
 */
export async function walletOfferLink(builderId: number, now: Date): Promise<string | null> {
  try {
    const [p] = await sql()<{ claimed: boolean; asked: boolean }[]>`
      SELECT x_user_id IS NOT NULL AND x_handle IS NOT NULL AS claimed, COALESCE(standing_seen ? 'wallet_asked', false) AS asked
      FROM builder_profiles WHERE builder_id = ${builderId}`;
    if (!p?.claimed || p.asked || (await provenWallet(builderId))) return null;
    const link = walletLink(builderId, now);
    if (!link) return null;
    const [taken] = await sql()`
      UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_asked', ${now.toISOString()}::text)
      WHERE builder_id = ${builderId} AND NOT COALESCE(standing_seen ? 'wallet_asked', false) RETURNING 1`;
    return taken ? link : null;
  } catch (err) {
    return logged('offer')(err);
  }
}

type Reply = Record<string, unknown>;
type WalletAsk = { kind: string; key: string | null; at?: string };

/** Stores the wallet step as the Bench's ask (its yes is answered as asked), with when it was asked. */
async function storeAsk(builderId: number, ask: WalletAsk): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(ask as never)}::jsonb)
    WHERE builder_id = ${builderId}`.catch(logged('store ask'));
}

/**
 * The builder's answer to the wallet step (bench-find.ts benchMoveUp routes the stored `wallet` ask here). Answered
 * once (the stored ask is taken first). A yes with a wallet proven since the ask: WALLET_DONE. A yes before the
 * signature: a fresh link and the same question (the ask kept). A no: WALLET_SKIPPED, remembered, never asked again.
 */
export async function answerWallet(builderId: number, asked: WalletAsk, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  const [taken] = await sql()`
    UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
    WHERE builder_id = ${builderId} AND standing_seen->'bench_ask' = ${sql().json(asked as never)}::jsonb RETURNING 1`.catch((err: unknown) => {
    logged('take ask')(err);
    return [];
  });
  if (!taken) return { show_to_builder: 'Okay.' };
  if (answer === 'no') {
    await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_skipped', ${now.toISOString()}::text)
      WHERE builder_id = ${builderId}`.catch(logged('skip'));
    return { show_to_builder: WALLET_SKIPPED };
  }
  const since = asked.at && !Number.isNaN(Date.parse(asked.at)) ? new Date(asked.at) : new Date(0);
  if (await provenSince(builderId, since).catch(logged('proven'))) return { show_to_builder: WALLET_DONE };
  const link = walletLink(builderId, now);
  if (!link) return { show_to_builder: WALLET_NO_LINK };
  await storeAsk(builderId, asked);
  return { show_to_builder: walletNotYet(link), move_up: { kind: 'wallet', project_key: asked.key, agent_note: WALLET_NOTE } };
}

/**
 * tell wallet: 'change': the builder wants their rewards sent to another wallet (or to add one). A fresh signing link,
 * stored as the Bench's ask so "done" is checked against a wallet proven from now on. Before the X sign-in there is no
 * page to sign for. Never shows a wallet address.
 */
export async function walletChangeReply(builderId: number, now: Date): Promise<Reply> {
  const [p] = await sql()<{ claimed: boolean; key: string | null }[]>`
    SELECT x_user_id IS NOT NULL AND x_handle IS NOT NULL AS claimed, main_project_key AS key FROM builder_profiles WHERE builder_id = ${builderId}`.catch((err: unknown) => {
    logged('change')(err);
    return [];
  });
  if (!p?.claimed) return { show_to_builder: WALLET_SIGN_IN_FIRST, agent_note: WALLET_SIGN_IN_NOTE };
  const link = walletLink(builderId, now);
  if (!link) return { show_to_builder: WALLET_NO_LINK };
  await storeAsk(builderId, { kind: 'wallet', key: p.key, at: now.toISOString() });
  return { show_to_builder: walletChange(link), move_up: { kind: 'wallet', project_key: p.key, agent_note: WALLET_NOTE } };
}
