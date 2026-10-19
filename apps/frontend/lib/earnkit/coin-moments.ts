import { repoKey } from './answer-bank';
import { raisingEnabled } from './builder-score-flag';
import { isWalletAddress } from './campaigns';
import { sql } from './db';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';
import { COIN_PROGRAM } from './policy-constants';
import { DECLINES_MAX, declines, offerIdentity, offerKey, readShownOffer, recordDecline, saveOffer } from './token-offers';
import { proposeToken, tokensFunTickerCheck, type TickerCheck } from './token-proposal';
import { tokenLaunchesAvailable } from './tokens';
import { repoReadPublic } from './repo-public';
import { earnkitOwnRepo } from './own-brand';

/**
 * v2.12.1 spec 3b, scoring and clarity R8: the token is offered only when the builder asks about one
 * (bench-find.ts tokenAsk, moment 'countable') or on the build path (built through EarnKit, the reply
 * that confirms the app is live: built_live); never in find's or score's default reply. At most once per
 * project; never again after DECLINES_MAX declines; the coin and the wallet shown before the yes; never for
 * shared clients or held profiles. first_five, has_people and streak_five are kept for offers already made.
 */
export { COIN_PROGRAM };
export type Moment = 'built_live' | 'countable' | 'first_five' | 'has_people' | 'streak_five';
export type Coin = { name: string; symbol: string };

/**
 * v2.13.3 review: the fees come first and the question last ("one question, last"). A known wallet is
 * a statement; with none known, the yes's reply asks for it (coinYes: COIN_WALLET_ASK).
 */
const coinFees = (wallet: string | null) => `A coin pays you 40% of its trading fees${wallet ? `, paid to ${shortWallet(wallet.toLowerCase())}` : ''}.`;

/** v2.13 spec "4. Optional: raise" (owner ruling B, v2.13.3: "a community round"): the coin is named before the yes; the wallet is shown when known (plan B13). Pure. */
export const raiseLine = (name: string, symbol: string, wallet: string | null) =>
  `I'll launch $${symbol} on tokens.fun and you get 40% of its trading fees${wallet ? `, paid to ${shortWallet(wallet.toLowerCase())}` : ''}. Want to open a community round for ${name}?`;

/**
 * The offer line for a moment: the coin that launches named (fix round 1, ruling 5: v2.8.1 A2, the
 * builder sees what launches) and the wallet shown when one is known (asked for after the yes, in
 * the next reply). Built through EarnKit, a no still enters the program, and the line says so
 * (ruling 6). One question. Pure.
 */
export function coinLine(moment: Moment, name: string, wallet: string | null, coin: Coin | null = null): string {
  // v2.13: every project moment is the raise line (built_live keeps its own);
  // final fix: only with EARNKIT_RAISING on, else v2.12.1's coin line.
  if (raisingEnabled() && moment !== 'built_live' && coin) return raiseLine(name, coin.symbol, wallet);
  const a = coin ? `a coin, $${coin.symbol} (${coin.name}),` : 'a coin';
  // v2.13.3 review: one question, last.
  if (moment === 'built_live') return `It's live, and your entry is ready either way. ${coinFees(wallet)} Want to launch ${a} for it?`;
  if (moment === 'first_five') return `5 people have used ${name}. ${coinFees(wallet)} Want to launch ${a} for it?`;
  if (moment === 'countable' || moment === 'streak_five') return `${coinFees(wallet)} Want to launch ${a} for ${name}?`;
  return `${name} has people using it. ${coinFees(wallet)} Want to launch ${a} for it?`;
}

/** The builder's line when a coin yes came without a wallet and none was shown. */
export const COIN_WALLET_ASK = 'Send me the wallet the fees should go to.';
const NOTED = 'Okay.';
/** Fix round 2: a yes after the coin launched. */
export const COIN_LIVE = 'Your coin is already live.';
export const COIN_LAUNCHING = 'Your coin is launching.';

/** The agent's note with a coin offer (find's move_up, a countable reply): how to pass the answer. */
export const COIN_NOTE =
  "The last line offers a coin. When the builder says yes, call tell with coin: { project_key, answer: 'yes' } (add wallet: the address they gave, if they gave one); " +
  "when they say no, answer: 'no'. Never launch anything before that yes.";
/**
 * coinYes's note: the confirm call that launches it. v2.14 spec 2: the gate checks the read-only App's
 * proof (token-gate.ts), so the note names no line.
 */
export const COIN_YES_NOTE = 'Call confirm with project_id, yes: true, wallet and token exactly as given.';

/** Not shared, a profile, not held (fail strict: no profile is no). */
async function guards(builderId: number): Promise<boolean> {
  if (await sharedGroup(builderId)) return false;
  const [p] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${builderId}`;
  return Boolean(p) && !p.held;
}

/** The project's confirmed repo and site, as an entry's links. */
async function confirmedLinks(builderId: number, projectKey: string): Promise<{ repo_url: string | null; live_url: string | null }> {
  const rows = await sql()<{ kind: string; ref: string }[]>`
    SELECT kind, ref FROM builder_sources
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) AND state = 'verified' AND kind IN ('repo', 'site')
    ORDER BY verified_at NULLS LAST, id`;
  const repo = rows.find((r) => r.kind === 'repo')?.ref ?? null;
  const site = rows.find((r) => r.kind === 'site')?.ref ?? null;
  return { repo_url: repo ? (/^https?:\/\//i.test(repo) ? repo : `https://github.com/${repo}`) : null, live_url: site };
}

const REPO_KEY = /^[a-z0-9-]+\/[a-z0-9._-]+$/i;

/**
 * Whether a coin may be offered for this project now: launches available, not a
 * shared group, a profile that isn't held, never offered for this project before, the project has
 * no coin (none on its page, none launched through EarnKit for it), fewer than DECLINES_MAX coin
 * offers declined, and (fix round 1, item 4) fewer than DECLINES_MAX skips of the confirm line's
 * token offer for its repo (token_declines, the existing rule).
 */
export async function coinAllowed(builderId: number, projectKey: string): Promise<boolean> {
  if (!tokenLaunchesAvailable() || (await sharedGroup(builderId))) return false;
  const [r] = await sql()<{ ok: boolean }[]>`
    SELECT NOT p.held
      AND NOT EXISTS (SELECT 1 FROM coin_moments m WHERE m.builder_id = ${builderId} AND lower(m.project_key) = lower(${projectKey}))
      AND NOT COALESCE((SELECT bool_or(has_coin) FROM builder_projects b WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${projectKey})), false)
      AND NOT EXISTS (SELECT 1 FROM projects x JOIN installations i ON i.id = x.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND x.token_url IS NOT NULL
          AND lower(x.repo_url) IN (lower(${`https://github.com/${projectKey}`}), lower(${`https://github.com/${projectKey}/`})))
      AND (SELECT count(*) FROM coin_moments m WHERE m.builder_id = ${builderId} AND m.answer = 'no') < ${DECLINES_MAX}
      AS ok
    FROM builder_profiles p WHERE p.builder_id = ${builderId}`;
  if (r?.ok !== true) return false;
  const { repo_url } = await confirmedLinks(builderId, projectKey);
  const url = repo_url ?? (REPO_KEY.test(projectKey) ? `https://github.com/${projectKey}` : null);
  if (!url) return true;
  const key = repoKey({ url, name: '' });
  return ((await declines(builderId, [key])).get(key) ?? 0) < DECLINES_MAX;
}

/**
 * Fix round 1 (ruling 3): a coin is offered at a project's own moments (not the build path's) only
 * when its yes can launch: coinAllowed, and the project has a confirmed repo (the launch needs one).
 */
export async function coinOfferable(builderId: number, projectKey: string): Promise<boolean> {
  if (!(await coinAllowed(builderId, projectKey))) return false;
  const { repo_url } = await confirmedLinks(builderId, projectKey);
  if (repo_url === null) return false;
  // v2.13.3 review (I1): never for a repo not read public (the coin and its tokens.fun page would name it).
  return (await repoReadPublic(builderId, repoOfUrl(repo_url)));
}
/** A confirmed repo link as its key (owner/repo, lowercase). Pure. */
const repoOfUrl = (u: string) => u.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?github\.com\//, '').replace(/(\.git)?\/*$/, '');

/** The wallet a coin's fees go to unless the builder names another: a proven one, else the group's first remembered one. */
export async function coinWallet(builderId: number): Promise<string | null> {
  const [proven] = await sql()<{ wallet: string }[]>`SELECT wallet FROM person_wallets WHERE builder_id = ${builderId} ORDER BY proven_at, wallet LIMIT 1`;
  if (proven) return proven.wallet;
  const [seen] = await sql()<{ wallet: string }[]>`
    SELECT w.wallet FROM installation_wallets w JOIN installations i ON i.id = w.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} ORDER BY w.first_seen_at, w.wallet LIMIT 1`;
  return seen?.wallet.toLowerCase() ?? null;
}

const offered = (builderId: number, key: string, moment: Moment) =>
  noteEvent('coin_offered', () => ({ type: 'coin_offered', dedupe_key: `coin_offered:${builderId}:${key.toLowerCase()}`, installation_id: builderId, detail: { moment } }));

/** Records the moment and the wallet its line shows (at most once per project). True when this call recorded it. */
async function claimMoment(builderId: number, key: string, moment: Moment, wallet: string | null): Promise<boolean> {
  const rows = await sql()`
    INSERT INTO coin_moments (builder_id, project_key, moment, wallet) VALUES (${builderId}, ${key}, ${moment}, ${wallet?.toLowerCase() ?? null})
    ON CONFLICT (builder_id, project_key) DO NOTHING RETURNING 1`;
  if (rows.length === 0) return false;
  await offered(builderId, key, moment);
  return true;
}

/**
 * The offer at one of a project's 3b moments: its line (the coin that launches and the wallet
 * shown when known, else asked after the yes) and the wallet, or null when it may not be offered (coinOfferable) or was
 * offered already. Callers show the line in the reply they build (shown: recorded). The pair is
 * saved as the shown offer, so the yes launches exactly it.
 */
export async function offerCoin(
  builderId: number,
  projectKey: string,
  moment: Exclude<Moment, 'built_live'>,
  deps: { check?: TickerCheck } = {},
): Promise<{ line: string; wallet: string | null } | null> {
  if (!(await coinOfferable(builderId, projectKey))) return null;
  const [p] = await sql()<{ name: string; project_key: string }[]>`
    SELECT name, project_key FROM builder_projects WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) ORDER BY project_key LIMIT 1`;
  if (!p) return null;
  const { repo_url } = await confirmedLinks(builderId, p.project_key);
  const wallet = await coinWallet(builderId);
  const pair = await proposeToken(p.name, deps.check ?? tokensFunTickerCheck, repo_url ?? undefined, { ownEarnkit: await earnkitOwnRepo(builderId, repo_url) });
  const coin = { name: pair.name, symbol: pair.symbol };
  if (!(await claimMoment(builderId, p.project_key, moment, wallet))) return null;
  await saveOffer(builderId, COIN_PROGRAM, offerKey(repo_url, p.name), coin, false, wallet);
  return { line: coinLine(moment, p.name, wallet, coin), wallet };
}

/**
 * R8 (tell token: 'ask'): an offer made and not answered yet, shown again as it was made: its moment's line,
 * the pair saved with it (proposed and saved now if none was) and the wallet it showed. Null when no open
 * offer (coinOpen) or the project is gone. The yes goes to coinYes as with the first showing.
 */
export async function openCoinLine(builderId: number, projectKey: string, deps: { check?: TickerCheck } = {}): Promise<{ line: string; wallet: string | null } | null> {
  const m = await momentOf(builderId, projectKey);
  if (!m || m.answer !== null || m.moment === 'built_live') return null;
  const [p] = await sql()<{ name: string }[]>`SELECT name FROM builder_projects WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  if (!p) return null;
  const { repo_url } = await confirmedLinks(builderId, m.project_key);
  const key = offerKey(repo_url, p.name);
  const shown = await readShownOffer(builderId, COIN_PROGRAM, key);
  const coin = shown
    ? { name: shown.name, symbol: shown.symbol }
    : await proposeToken(p.name, deps.check ?? tokensFunTickerCheck, repo_url ?? undefined, { ownEarnkit: await earnkitOwnRepo(builderId, repo_url) });
  if (!shown) await saveOffer(builderId, COIN_PROGRAM, key, { name: coin.name, symbol: coin.symbol }, false, m.wallet);
  return { line: coinLine(m.moment, p.name, m.wallet, { name: coin.name, symbol: coin.symbol }), wallet: m.wallet };
}

type MomentRow = { project_key: string; moment: Moment; answer: 'yes' | 'no' | null; project_id: number | null; wallet: string | null };
const momentOf = async (builderId: number, projectKey: string) =>
  (await sql()<MomentRow[]>`
    SELECT project_key, moment, answer, project_id, wallet FROM coin_moments WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) LIMIT 1`)[0] ?? null;

/**
 * The yes to a coin offer: one entry in the internal coin program (the project's own name and
 * confirmed links, the wallet), the pair its line named saved as the shown offer (with the wallet)
 * so confirm by project_id launches exactly it. Only for an offer made and not declined; a repeat
 * yes reuses the same entry. Fix round 1 (critical): a yes naming another wallet than the one the
 * line showed launches nothing: the line is shown again with that wallet (stored), and only a yes
 * to it goes on. No wallet shown and none given: the builder is asked.
 */
export async function coinYes(
  builderId: number,
  projectKey: string,
  wallet: string | null,
  deps: { check?: TickerCheck } = {},
): Promise<{ project_id: number; token: Coin; wallet: string | null; agent_note: string } | { show_to_builder: string; agent_note?: string }> {
  if (!(await guards(builderId))) return { show_to_builder: NOTED };
  const m = await momentOf(builderId, projectKey);
  if (!m || m.answer === 'no' || m.moment === 'built_live') return { show_to_builder: NOTED };
  const [p] = await sql()<{ name: string }[]>`SELECT name FROM builder_projects WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  if (!p) return { show_to_builder: NOTED };
  const links = await confirmedLinks(builderId, m.project_key);
  const [existing] = m.project_id
    ? await sql()<{ id: number; repo_url: string | null; token_url: string | null; token_status: string | null }[]>`
        SELECT id, repo_url, token_url, token_status FROM projects WHERE id = ${m.project_id} AND installation_id = ${builderId} AND program_id = ${COIN_PROGRAM}`
    : [];
  // Fix round 2: the coin is out (or launching): nothing is shown again or rewritten.
  if (existing?.token_url) return { show_to_builder: existing.token_url === 'pending' ? COIN_LAUNCHING : COIN_LIVE };
  const repoUrl = existing ? existing.repo_url : links.repo_url;
  const key = offerKey(repoUrl, p.name);
  const shown = await readShownOffer(builderId, COIN_PROGRAM, key);
  const given = wallet && isWalletAddress(wallet.trim()) ? wallet.trim().toLowerCase() : null;
  // A launch already tried (a proof line missing, say): the same entry, pair and wallet, never rewritten.
  if (existing && existing.token_status && shown && m.answer === 'yes')
    return { project_id: existing.id, token: { name: shown.name, symbol: shown.symbol }, wallet: shown.wallet, agent_note: COIN_YES_NOTE };
  /**
   * The line again, and a fresh yes waited for (fix rounds 1 and 2): a wallet the line didn't show,
   * or no saved pair (never one proposed silently). An accepted offer goes back to open, so confirm
   * by project_id launches nothing until the builder says yes to what this line shows.
   */
  const again = async (to: string | null, coin: Coin) => {
    await sql()`
      UPDATE coin_moments SET wallet = ${to}, answer = NULL, answered_at = NULL
      WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
    await saveOffer(builderId, COIN_PROGRAM, key, coin, false, to);
    return { show_to_builder: coinLine(m.moment, p.name, to, coin), agent_note: COIN_NOTE };
  };
  if (!shown) {
    const pair = await proposeToken(p.name, deps.check ?? tokensFunTickerCheck, repoUrl ?? undefined, { ownEarnkit: await earnkitOwnRepo(builderId, repoUrl) });
    return again(given ?? m.wallet, { name: pair.name, symbol: pair.symbol });
  }
  const coin: Coin = { name: shown.name, symbol: shown.symbol };
  if (given && m.wallet && given !== m.wallet) return again(given, coin);
  // A wallet given when the line asked for one is the builder's answer to it.
  const to = given ?? m.wallet;
  if (!to) return { show_to_builder: COIN_WALLET_ASK };
  if (!m.wallet) await sql()`UPDATE coin_moments SET wallet = ${to} WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  // v2.13.3 review (I1): a repo no longer read public (it went private after the offer): the coin, if made,
  // carries only the page's safe name and no repo link, so nothing on tokens.fun names the repo.
  if (!existing && links.repo_url && !(await repoReadPublic(builderId, repoOfUrl(links.repo_url)))) {
    const safe = (await (await import('./page-data')).safeNames([builderId]))(builderId, m.project_key);
    const pair = await proposeToken(safe, deps.check ?? tokensFunTickerCheck, undefined);
    const hidden: Coin = { name: pair.name, symbol: pair.symbol };
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, creator_wallet, confirmed_at, confirm_choice)
      VALUES (${COIN_PROGRAM}, ${safe}, ${null}, ${links.live_url}, ${builderId}, ${to}, now(), 'go') RETURNING id`;
    await saveOffer(builderId, COIN_PROGRAM, offerKey(null, safe), hidden, false, to);
    await sql()`
      UPDATE coin_moments SET answer = 'yes', answered_at = COALESCE(answered_at, now()), project_id = ${id}
      WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
    return { project_id: id, token: hidden, wallet: to, agent_note: COIN_YES_NOTE };
  }
  const projectId = existing
    ? existing.id
    : (
        await sql()<{ id: number }[]>`
          INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, creator_wallet, confirmed_at, confirm_choice)
          VALUES (${COIN_PROGRAM}, ${p.name}, ${links.repo_url}, ${links.live_url}, ${builderId}, ${to}, now(), 'go') RETURNING id`
      )[0].id;
  if (existing) await sql()`UPDATE projects SET creator_wallet = ${to} WHERE id = ${projectId} AND token_url IS NULL`;
  // v2.13 spec "4. Optional: raise": the yes is the raise; the pill shows once the coin is launched.
  // Final fix: only with EARNKIT_RAISING on (off, the yes was to v2.12.1's coin line, not a raise).
  if (raisingEnabled()) {
    await sql()`UPDATE projects SET raising_at = COALESCE(raising_at, now()) WHERE id = ${projectId}`;
    await noteEvent('raising_on', () => ({
      type: 'raising_on', dedupe_key: `raising_on:${projectId}:${new Date().toISOString().slice(0, 10)}`, installation_id: builderId, project_id: projectId,
    }));
  }
  await saveOffer(builderId, COIN_PROGRAM, key, coin, false, to);
  await sql()`
    UPDATE coin_moments SET answer = 'yes', answered_at = COALESCE(answered_at, now()), project_id = ${projectId}
    WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  await noteEvent('coin_answered', () => ({
    type: 'coin_answered', dedupe_key: `coin_answered:${builderId}:${m.project_key.toLowerCase()}`, installation_id: builderId, project_id: projectId, detail: { answer: 'yes', moment: m.moment },
  }));
  return { project_id: projectId, token: coin, wallet: to, agent_note: COIN_YES_NOTE };
}

/** The no to a coin offer: never offered for this project again, and one of the DECLINES_MAX (recordDecline, as the confirm line's skip). */
export async function coinNo(builderId: number, projectKey: string): Promise<void> {
  const m = await momentOf(builderId, projectKey);
  if (!m || m.answer !== null) return;
  const [p] = await sql()<{ name: string }[]>`SELECT name FROM builder_projects WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  const name = p?.name ?? m.project_key;
  const { repo_url } = await confirmedLinks(builderId, m.project_key);
  const updated = await sql()`
    UPDATE coin_moments SET answer = 'no', answered_at = now() WHERE builder_id = ${builderId} AND project_key = ${m.project_key} AND answer IS NULL RETURNING 1`;
  if (updated.length === 0) return;
  const offer = await offerIdentity(builderId, COIN_PROGRAM, offerKey(repo_url, name)).catch(() => `${COIN_PROGRAM}:${m.project_key}`);
  await recordDecline(builderId, repoKey({ url: repo_url, name }), new Date(), { login: '', offer }).catch((err: unknown) =>
    console.error('[coin] decline', err instanceof Error ? err.name : 'error'),
  );
  await noteEvent('coin_answered', () => ({
    type: 'coin_answered', dedupe_key: `coin_answered:${builderId}:${m.project_key.toLowerCase()}`, installation_id: builderId, detail: { answer: 'no', moment: m.moment },
  }));
}

/** The offer is open: made and not answered yet (a tell yes or no answers it). */
export async function coinOpen(builderId: number, projectKey: string): Promise<boolean> {
  const m = await momentOf(builderId, projectKey);
  return m !== null && m.answer === null;
}

/**
 * Whether this entry's confirm may pitch (and launch) a token: only the coin program's own entry (fix round
 * 1, item 2), for the person's guards (not shared, not held) and an offer they said yes to that names this
 * entry. Scoring and clarity R8 (Task 4 fix round 1): the build path no longer pitches a coin at its live
 * reply (built_live); a coin comes only from tell token: 'ask'. Any other entry: never ("nowhere else");
 * EarnKit campaign entries are exempt at their call sites.
 */
export async function coinPitchAllowed(builderId: number, entry: { program_id: string; project_id?: number }): Promise<boolean> {
  if (entry.program_id === COIN_PROGRAM) {
    if (!(await guards(builderId))) return false;
    // Fix round 2: a coin entry is checked only by its project_id (an accepted offer names it).
    if (entry.project_id === undefined) return false;
    const [m] = await sql()`SELECT 1 FROM coin_moments WHERE builder_id = ${builderId} AND project_id = ${entry.project_id} AND answer = 'yes'`;
    return Boolean(m);
  }
  return false;
}
