import { sql } from './db';
import { shortWallet } from './entry-text';
import {
  WALLET_BUILDER_CODE, WALLET_COIN_FEES, WALLET_SETUP_SKIPPED, WALLET_SKIPPED, walletChange, walletChangeX, walletContractsOnly, walletDone, walletNotYet, walletNotice,
} from './bench-reply';
import { provenSince, provenWallet, walletLink } from './wallet-proof';
import { COIN_PROGRAM } from './policy-constants';
import { builderToken, builderTokensOn } from './builder-token';
import { tokenAnswerFor } from './token-answers';

/** v3.1 cold read: no wallet step within this many days of a fee wallet given for a coin. */
export const FEE_WALLET_QUIET_DAYS = 7;

/**
 * v3.1 wallet proof (owner-approved 2026-10-23): "ask in the onboarding after the profile is created as an optional
 * step; this way we get their wallet right after we created their profile and then we never have to ask it again
 * unless they want to change it to a different reward recipient."
 *
 * The offer is the ranked reply's `wallet` step (bench-reply.ts stateAsk): once a person, claimed only when the reply
 * carries it (standing_seen.wallet_asked, takeWalletAsk), never once a wallet is proven. Every link given starts the
 * wallet's state (standing_seen.wallet_link_at); "done" is answered from that state (a wallet proven since), so an
 * agent's "done" after another reply still checks it. "skip" ends it and the step is never offered again. tell wallet
 * 'change' sends a fresh link; replacing a reward wallet needs the page's X sign-in (wallet-proof.ts). A changed
 * recipient is said once on the next reply (takeWalletNotice).
 */

/** The agent's note with the wallet step: the builder signs on the page; "done" is a yes, "skip" a no. */
export const WALLET_NOTE =
  "The builder signs on the page from the link; never ask for a wallet address. When they say done, call tell with move_up: { kind: 'wallet', project_key, answer: 'yes' }; " +
  "skip or no: answer 'no' (project_key as given here). If they ask later to change their reward wallet, call tell with wallet: 'change'. " +
  "With no project yet: if the builder wants to connect after all, call tell with move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' }. Don't show this note.";
/** tell wallet before the X sign-in: there is no page to sign for yet. */
export const WALLET_SIGN_IN_FIRST = 'Sign in with X first, then ask me again to add your reward wallet.';
export const WALLET_SIGN_IN_NOTE = "Call find for the sign-in link. Don't show this note.";
/** No signing link can be made (EARNKIT_AUTH_SECRET unset). */
export const WALLET_NO_LINK = "I can't make a wallet link right now. Try again later.";

const logged = (what: string) => (err: unknown) => {
  console.error(`[wallet offer] ${what}`, err instanceof Error ? err.name : 'error');
  return null;
};
const okay = { show_to_builder: 'Okay.' };
type Reply = Record<string, unknown>;

/**
 * The optional wallet step's signing link, when it may be offered now: a claimed page (an X sign-in), no wallet proven
 * yet, never offered before. Nothing is claimed here (takeWalletAsk claims it once the reply carries it). Never throws.
 */
export async function walletOfferDue(builderId: number, now: Date): Promise<string | null> {
  try {
    // v3.1 cold read: only for a builder with contracts on Base known or reported (the step's whole point: "so your
    // contracts show"), and never right after a fee wallet was given for a coin (within FEE_WALLET_QUIET_DAYS).
    const [p] = await sql()<{ claimed: boolean; asked: boolean; any: boolean; contracts: boolean; fee_wallet: boolean }[]>`
      SELECT x_user_id IS NOT NULL AND x_handle IS NOT NULL AS claimed, COALESCE(standing_seen ? 'wallet_asked', false) AS asked,
        EXISTS (SELECT 1 FROM person_wallets w WHERE w.builder_id = ${builderId}) AS any,
        main_project_key IS NOT NULL AND (
          EXISTS (SELECT 1 FROM builder_projects b WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(p.main_project_key) AND 'base' = ANY(b.chains))
          OR EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${builderId} AND lower(s.project_key) = lower(p.main_project_key)
            AND s.kind = 'contract' AND s.state <> 'rejected' AND s.ref ILIKE 'base:%')
          OR EXISTS (SELECT 1 FROM builder_repo_facts f JOIN installations i ON i.id = f.installation_id
            WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND lower(f.repo_key) = lower(p.main_project_key) AND 'base' = ANY(f.mainnet_chains))
        ) AS contracts,
        EXISTS (SELECT 1 FROM projects j JOIN installations i ON i.id = j.installation_id
          WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND j.program_id = ${COIN_PROGRAM} AND j.creator_wallet IS NOT NULL
            AND j.confirmed_at > ${now}::timestamptz - make_interval(days => ${FEE_WALLET_QUIET_DAYS})) AS fee_wallet
      FROM builder_profiles p WHERE builder_id = ${builderId}`;
    if (!p?.claimed || p.asked || p.any || !p.contracts || p.fee_wallet) return null;
    return walletLink(builderId, now);
  } catch (err) {
    return logged('offer')(err);
  }
}
/** v4.0: the agent's note with setup step 3, with the token sentence or without it. */
export const walletSetupNote = (token: boolean) =>
  "The builder signs on the page from the link; never ask for a wallet address. When they say done, call tell with move_up: { kind: 'wallet', project_key, answer: 'yes' }; " +
  "if they skip adding a wallet: { kind: 'wallet', project_key, answer: 'no' }. " +
  (token
    ? "A no to their token (a plain no to this step means the token, not the wallet): { kind: 'token', project_key, answer: 'no' }; they can still sign. "
    : '') +
  "If they ask later to launch their token: { kind: 'token', project_key, answer: 'yes' }. Don't show this note.";

/**
 * v4.0 setup step 3 (docs/design-docs-and-implementation-plans/v4-builder-tokens.md, approved copy 3): the wallet step for
 * every builder, its signing link when due now: a claimed X account, step 2 done (a repo proven by the App) or answered
 * no (standing_seen.github_no), no wallet proven yet, never asked before (standing_seen.wallet_asked). In place of
 * walletOfferDue's Base-contracts condition. Nothing is claimed here (takeWalletAsk with setup, once the reply carries
 * it). Never throws.
 */
export async function walletSetupDue(builderId: number, now: Date): Promise<string | null> {
  try {
    const [p] = await sql()<{ claimed: boolean; asked: boolean; any: boolean; step2: boolean }[]>`
      SELECT x_user_id IS NOT NULL AND x_handle IS NOT NULL AS claimed, COALESCE(standing_seen ? 'wallet_asked', false) AS asked,
        EXISTS (SELECT 1 FROM person_wallets w WHERE w.builder_id = ${builderId}) AS any,
        COALESCE(standing_seen ? 'github_no', false)
          OR EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${builderId} AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app') AS step2
      FROM builder_profiles WHERE builder_id = ${builderId}`;
    if (!p?.claimed || p.asked || p.any || !p.step2) return null;
    return walletLink(builderId, now);
  } catch (err) {
    return logged('setup')(err);
  }
}
/** v4.0: step 3 carries the token sentence: tokens on, a claimed X account, no token row (a no is kept forever). Never throws. */
export async function walletSetupToken(builderId: number): Promise<boolean> {
  if (!builderTokensOn()) return false;
  try {
    const [p] = await sql()<{ x: string | null }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${builderId}`;
    return Boolean(p?.x) && (await builderToken(builderId)) === null;
  } catch (err) {
    logged('setup token')(err);
    return false;
  }
}

/**
 * The wallet step, claimed once a person when its reply is built (one guarded UPDATE), its state started. v4.0 `setup`:
 * it is setup step 3 (standing_seen.wallet_setup, and setup_asked, kept: v4.0 Task 5's setup-done reply), so its skip is step 3's. v4.0 fix round 1 `token`: the reply carries
 * the token sentence (standing_seen.token_offered, kept): only then does the first wallet proof launch the token, and a
 * plain no to step 3 decline it. Never throws.
 */
export async function takeWalletAsk(builderId: number, now: Date, setup = false, token = false): Promise<boolean> {
  const [taken] = await sql()`
    UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('wallet_asked', ${now.toISOString()}::text, 'wallet_link_at', ${now.toISOString()}::text)
      || (CASE WHEN ${setup} THEN jsonb_build_object('wallet_setup', ${now.toISOString()}::text, 'setup_asked', ${now.toISOString()}::text) ELSE '{}'::jsonb END)
      || (CASE WHEN ${setup && token} THEN jsonb_build_object('token_offered', ${now.toISOString()}::text) ELSE '{}'::jsonb END)
    WHERE builder_id = ${builderId} AND NOT COALESCE(standing_seen ? 'wallet_asked', false) RETURNING 1`.catch((err: unknown) => {
    logged('take')(err);
    return [];
  });
  return Boolean(taken);
}
/** v4.0 fix round 1: the builder saw step 3's token sentence (standing_seen.token_offered). A failed read: false. Never throws. */
export async function tokenOffered(builderId: number): Promise<boolean> {
  const [p] = await sql()<{ offered: boolean }[]>`
    SELECT COALESCE(standing_seen ? 'token_offered', false) AS offered FROM builder_profiles WHERE builder_id = ${builderId}`.catch((err: unknown) => {
    logged('token offered')(err);
    return [];
  });
  return p?.offered === true;
}
/** A link was given (the change link): the state starts now. */
async function linkGiven(builderId: number, now: Date): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_link_at', ${now.toISOString()}::text)
    WHERE builder_id = ${builderId}`.catch(logged('link given'));
}

/**
 * v4.2: after a reward wallet signed, the token's state in the same reply: just launched by this sign (the trade link and
 * the page), already live (the Live copy), or on its way. Null when the builder has no token row (declined or never offered). Never throws.
 */
async function signedTokenLine(builderId: number, now: Date, linkAt: Date): Promise<string | null> {
  try {
    const [t] = await sql()<{ status: string; fresh: boolean }[]>`
      SELECT status, created_at >= ${linkAt} AS fresh FROM builder_tokens WHERE builder_id = ${builderId}`;
    if (!t || t.status === 'declined') return null;
    // "Done." only when this sign made the token (its row began after the link was given); a wallet change on a live token is the Live copy.
    return await tokenAnswerFor(builderId, now, { justLaunched: t.status === 'launched' && t.fresh });
  } catch (err) {
    logged('signed token')(err);
    return null;
  }
}

/**
 * The builder's answer to the wallet step or the change link (bench-find.ts benchMoveUp: move_up kind 'wallet', or
 * the stored ask). Answered by the state, not the stored ask: no link given (or answered already): "Okay.". A yes with a
 * wallet proven since the link: done (the recipient's short wallet, or contracts only); a yes before the signature: a
 * fresh link and the same question; a no: WALLET_SKIPPED. The stored wallet ask is cleared.
 */
export async function answerWallet(builderId: number, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  const [p] = await sql()<{ at: string | null; key: string | null; setup: boolean }[]>`
    SELECT standing_seen->>'wallet_link_at' AS at, main_project_key AS key, COALESCE(standing_seen ? 'wallet_setup', false) AS setup
    FROM builder_profiles WHERE builder_id = ${builderId}`.catch((err: unknown) => {
    logged('state')(err);
    return [];
  });
  if (!p?.at || Number.isNaN(Date.parse(p.at))) return okay;
  const end = () =>
    sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'wallet_link_at') - 'wallet_notice' - 'wallet_setup'
        - (CASE WHEN standing_seen->'bench_ask'->>'kind' IN ('wallet', 'wallet_setup') THEN 'bench_ask' ELSE '' END)
      WHERE builder_id = ${builderId} AND standing_seen->>'wallet_link_at' = ${p.at}::text RETURNING 1`.catch((err: unknown) => {
      logged('end')(err);
      return [];
    });
  // v4.0: a skip of setup step 3 is remembered the same way (never asked again); no wallet, so no token.
  if (answer === 'no') return (await end()).length ? { show_to_builder: p.setup ? WALLET_SETUP_SKIPPED : WALLET_SKIPPED } : okay;
  const got = await provenSince(builderId, new Date(p.at)).catch(logged('proven'));
  if (got) {
    if (!(await end()).length) return okay;
    const token = got.recipient ? await signedTokenLine(builderId, now, new Date(p.at)) : null;
    if (got.recipient) return { show_to_builder: [walletDone(shortWallet(got.wallet)), token].filter(Boolean).join('\n\n') };
    const current = await provenWallet(builderId);
    return { show_to_builder: current ? walletContractsOnly(shortWallet(current)) : walletDone(shortWallet(got.wallet)) };
  }
  const link = walletLink(builderId, now);
  if (!link) return { show_to_builder: 'I can\'t make a wallet link right now. Try again later.' };
  return { show_to_builder: walletNotYet(link), move_up: { kind: 'wallet', project_key: p.key, agent_note: WALLET_NOTE } };
}

/**
 * tell wallet: 'change': the builder wants their rewards sent to another wallet (or to add one). A fresh signing link
 * (the state starts now). With a reward wallet already: its short form, that the page asks for X first, and, only when
 * true, that the Base Builder Code stays on the first wallet and a launched project coin's or builder token's fees stay
 * with its launch wallet.
 * Before the X sign-in there is no page to sign for.
 */
export async function walletChangeReply(builderId: number, now: Date): Promise<Reply> {
  const [p] = await sql()<{ claimed: boolean; key: string | null; code: boolean; coin: boolean }[]>`
    SELECT x_user_id IS NOT NULL AND x_handle IS NOT NULL AS claimed, main_project_key AS key, base_builder_code IS NOT NULL AS code,
      EXISTS (SELECT 1 FROM projects j JOIN installations i ON i.id = j.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND j.token_url IS NOT NULL AND j.token_url <> 'pending')
      -- v4.0 final review 4: the builder's own token, once launched, keeps its launch wallet too.
      OR EXISTS (SELECT 1 FROM builder_tokens t WHERE t.builder_id = ${builderId} AND t.status = 'launched') AS coin
    FROM builder_profiles WHERE builder_id = ${builderId}`.catch((err: unknown) => {
    logged('change')(err);
    return [];
  });
  if (!p?.claimed) return { show_to_builder: WALLET_SIGN_IN_FIRST, agent_note: WALLET_SIGN_IN_NOTE };
  const link = walletLink(builderId, now);
  if (!link) return { show_to_builder: WALLET_NO_LINK };
  await linkGiven(builderId, now);
  const current = await provenWallet(builderId);
  const extras = [p.code && current ? WALLET_BUILDER_CODE : null, p.coin ? WALLET_COIN_FEES : null].filter((x): x is string => x !== null);
  const line = current ? walletChangeX(shortWallet(current), link, extras) : walletChange(link, extras);
  return { show_to_builder: line, move_up: { kind: 'wallet', project_key: p.key, agent_note: WALLET_NOTE } };
}

/** "Your reward wallet changed to 0x12ab…abcd." once, on the next reply after the recipient changed. Never throws. */
export async function takeWalletNotice(builderId: number): Promise<string | null> {
  const [r] = await sql()<{ short: string | null }[]>`
    UPDATE builder_profiles p SET standing_seen = p.standing_seen - 'wallet_notice'
    FROM (SELECT standing_seen->>'wallet_notice' AS short FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE) o
    WHERE p.builder_id = ${builderId} AND o.short IS NOT NULL RETURNING o.short AS short`.catch((err: unknown) => {
    logged('notice')(err);
    return [];
  });
  return r?.short ? walletNotice(r.short) : null;
}
