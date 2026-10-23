import { repoKey } from './answer-bank';
import { raisingEnabled } from './builder-score-flag';
import { isWalletAddress } from './campaigns';
import { sql } from './db';
import { provenWallet } from './wallet-proof';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';
import { BACKING_EXCLUDED_REPOS, COIN_PROGRAM } from './policy-constants';
import { hasFacts, type WeekFacts } from './week-facts';
import { DECLINES_MAX, declines, offerIdentity, offerKey, readShownOffer, recordDecline, saveOffer } from './token-offers';
import { proposeToken, tokensFunTickerCheck, type TickerCheck } from './token-proposal';
import { tokenLaunchesAvailable } from './tokens';
import { repoReadPublic } from './repo-public';
import { earnkitOwnRepo } from './own-brand';
import { reportedName, reportedProject } from './project-name';

/** The stored identity's projects (empty on none or a read error). Never throws. */
async function reportedProjects(builderId: number): Promise<{ live_url?: unknown; repo?: unknown }[]> {
  const [p] = await sql()<{ projects: unknown }[]>`SELECT identity->'projects' AS projects FROM builder_profiles WHERE builder_id = ${builderId}`.catch(() => []);
  return Array.isArray(p?.projects) ? (p.projects as { live_url?: unknown }[]) : [];
}
/** The live link the builder reported for `key`'s project, or null. Pure. */
const reportedLiveOf = (projects: { live_url?: unknown }[], key: string) => {
  const p = reportedProject(projects, key);
  return typeof p?.live_url === 'string' && /^https:\/\//i.test(p.live_url) ? p.live_url : null;
};

/**
 * v2.12.1 spec 3b, scoring and clarity R8: the token is offered only when the builder asks about one
 * (bench-find.ts tokenAsk, moment 'countable'), never in find's, score's or the build path's default reply. At most once per
 * project; never again after DECLINES_MAX declines; the coin and the wallet shown before the yes; never for
 * shared clients or held profiles. first_five, has_people and streak_five are kept for offers already made.
 */
export { COIN_PROGRAM };
/** v3 Stage 2 (spec 5.3 Route 2): `first_week`, the backing offer after the first approved week with code (backingOffer). */
export type Moment = 'built_live' | 'countable' | 'first_five' | 'has_people' | 'streak_five' | 'first_week';
export type Coin = { name: string; symbol: string };

/**
 * v2.13.3 review: the fees come first and the question last ("one question, last"). A known wallet is
 * a statement; with none known, the yes's reply asks for it (coinYes: COIN_WALLET_ASK).
 */
const coinFees = (wallet: string | null) => `A coin pays you 40% of its trading fees${wallet ? `, paid to ${shortWallet(wallet.toLowerCase())}` : ''}.`;

/**
 * v3 Stage 2 (spec 5.3 Route 2): the backing offer, the one question of the first ranked reply after the first approved
 * week with code. The coin is named and the wallet shown when known, before the yes. Pure.
 */
export const BACKING_OFFER = (name: string, symbol: string, wallet: string | null) =>
  `I can launch $${symbol}, a coin for ${name} on Base. Every trade pays a fee and you keep 40%${wallet ? `, sent to ${shortWallet(wallet.toLowerCase())}` : ''}. Coins can go to zero. Launch it?`;
/** v2.13's offer line under EARNKIT_RAISING (tell token: 'ask'); v3 Stage 2: the backing offer's words. Pure. */
export const raiseLine = (name: string, symbol: string, wallet: string | null) => BACKING_OFFER(name, symbol, wallet);

/**
 * The offer line for a moment: the coin that launches named (fix round 1, ruling 5: v2.8.1 A2, the
 * builder sees what launches) and the wallet shown when one is known (asked for after the yes, in
 * the next reply). Built through EarnKit, a no still enters the program, and the line says so
 * (ruling 6). One question. Pure.
 */
export function coinLine(moment: Moment, name: string, wallet: string | null, coin: Coin | null = null): string {
  // v2.13: every project moment is the backing offer (built_live keeps its own);
  // final fix: only with EARNKIT_RAISING on, else v2.12.1's coin line.
  if (raisingEnabled() && moment !== 'built_live' && coin) return BACKING_OFFER(name, coin.symbol, wallet);
  const a = coin ? `a coin, $${coin.symbol} (${coin.name}),` : 'a coin';
  // v2.13.3 review: one question, last.
  if (moment === 'built_live') return `It's live, and your entry is ready either way. ${coinFees(wallet)} Want to launch ${a} for it?`;
  if (moment === 'first_five') return `5 people have used ${name}. ${coinFees(wallet)} Want to launch ${a} for it?`;
  if (moment === 'countable' || moment === 'streak_five' || moment === 'first_week') return `${coinFees(wallet)} Want to launch ${a} for ${name}?`;
  return `${name} has people using it. ${coinFees(wallet)} Want to launch ${a} for it?`;
}

/** The builder's line when a coin yes came without a wallet and none was shown. */
export const COIN_WALLET_ASK = 'Send me the wallet the fees should go to.';
const NOTED = 'Okay.';
/** GTM W2: a private repo with no public name (no proven site, no name of the builder's own) can't carry a coin. */
export const COIN_NO_PUBLIC_NAME = "Your repo is private and your project has no public name yet, so a coin can't launch for it.";
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
/** v3 Stage 2: a project key (owner/repo or its GitHub link) in BACKING_EXCLUDED_REPOS, compared lowercase. Pure. */
export const backingExcluded = (projectKey: string) =>
  (BACKING_EXCLUDED_REPOS as readonly string[]).includes(projectKey.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?github\.com\//, '').replace(/(\.git)?\/*$/, ''));

/**
 * Whether a coin may be offered for this project now: launches available, not a
 * shared group, a profile that isn't held, never offered for this project before, the project has
 * no coin (none on its page, none launched through EarnKit for it), fewer than DECLINES_MAX coin
 * offers declined, and (fix round 1, item 4) fewer than DECLINES_MAX skips of the confirm line's
 * token offer for its repo (token_declines, the existing rule).
 */
export async function coinAllowed(builderId: number, projectKey: string, o: { asked?: boolean } = {}): Promise<boolean> {
  // v3 Stage 2 review: EarnKit's own repo is never offered a coin or backing, by any entry point (offerCoin, openCoinLine, coinYes).
  if (backingExcluded(projectKey)) return false;
  if (!tokenLaunchesAvailable() || (await sharedGroup(builderId))) return false;
  // v3.1 cold read: the builder asking (tell token: 'ask') is a new yes path: an offer made or declined before, and the
  // declines cap, no longer stop it; every other gate holds.
  const asked = o.asked === true;
  const [r] = await sql()<{ ok: boolean }[]>`
    SELECT NOT p.held
      AND (${asked}::boolean OR NOT EXISTS (SELECT 1 FROM coin_moments m WHERE m.builder_id = ${builderId} AND lower(m.project_key) = lower(${projectKey})))
      AND NOT COALESCE((SELECT bool_or(has_coin) FROM builder_projects b WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${projectKey})), false)
      AND NOT EXISTS (SELECT 1 FROM projects x JOIN installations i ON i.id = x.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND x.token_url IS NOT NULL
          AND lower(x.repo_url) IN (lower(${`https://github.com/${projectKey}`}), lower(${`https://github.com/${projectKey}/`})))
      AND (${asked}::boolean OR (SELECT count(*) FROM coin_moments m WHERE m.builder_id = ${builderId} AND m.answer = 'no') < ${DECLINES_MAX})
      AS ok
    FROM builder_profiles p WHERE p.builder_id = ${builderId}`;
  if (r?.ok !== true) return false;
  const { repo_url } = await confirmedLinks(builderId, projectKey);
  const url = repo_url ?? (REPO_KEY.test(projectKey) ? `https://github.com/${projectKey}` : null);
  if (!url) return true;
  if (backingExcluded(url)) return false;
  if (asked) return true;
  const key = repoKey({ url, name: '' });
  return ((await declines(builderId, [key])).get(key) ?? 0) < DECLINES_MAX;
}

/**
 * Fix round 1 (ruling 3): a coin is offered at a project's own moments (not the build path's) only
 * when its yes can launch: coinAllowed, and the project has a confirmed repo (the launch needs one).
 */
export async function coinOfferable(builderId: number, projectKey: string, o: { asked?: boolean } = {}): Promise<boolean> {
  if (!(await coinAllowed(builderId, projectKey, o))) return false;
  const { repo_url } = await confirmedLinks(builderId, projectKey);
  if (repo_url === null) return false;
  // v2.13.3 review (I1): a repo not read public is never named by the coin. GTM W2 (2026-10-23): it can still have one
  // when the project has a public name (a proven site, or the name the builder gave: publicName), launched under it.
  if (await repoReadPublic(builderId, repoOfUrl(repo_url))) return true;
  return (await coinName(builderId, projectKey, projectKey, repo_url, true)) !== null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * v3.1 cold read (one name everywhere): the name a coin and its offer use: the name the builder gave (reportedName) wins.
 * A private repo's coin never carries the repo's own name, so there the given name counts only when it isn't the repo's
 * name or it is the proven site's name too (it is public there); else the page's public name (publicName), or null.
 */
async function coinName(builderId: number, projectKey: string, rowName: string, repoUrl: string | null, hidden: boolean): Promise<string | null> {
  const given = await reportedName(builderId, projectKey);
  if (!hidden) return given ?? rowName;
  if (given) {
    const repo = repoUrl ? repoOfUrl(repoUrl).split('/').pop() ?? '' : '';
    const { live_url } = await confirmedLinks(builderId, projectKey);
    // The proven site's name, else the live link the builder reported for this project (the name is public there).
    const reported = live_url ?? reportedLiveOf(await reportedProjects(builderId), projectKey);
    const site = reported && URL.canParse(reported) ? new URL(reported).hostname.replace(/^www\./, '').split('.')[0] : '';
    if (squash(given) !== squash(repo) || (site && squash(site) === squash(given))) return given;
  }
  const safe = await publicName(builderId, projectKey);
  // The page's public name is the site's host ("tipflow.xyz") and the builder calls it "TipFlow": their name.
  if (safe && given && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(safe) && squash(safe.split('.')[0]) === squash(given)) return given;
  return safe;
}
/** A confirmed repo not read public: the coin's name and launch carry no repo link. True when this one is. */
async function hiddenRepo(builderId: number, repoUrl: string | null): Promise<boolean> {
  return repoUrl !== null && !(await repoReadPublic(builderId, repoOfUrl(repoUrl)));
}
/**
 * GTM W2: a private repo's public name, the page's own safe name (page-data.ts safeNames: a proven site's name, or the
 * name the builder gave that isn't the repo's), else null (no coin: nothing public to call it).
 */
export async function publicName(builderId: number, projectKey: string): Promise<string | null> {
  const { safeNames, PRIVATE_NAME } = await import('./page-data');
  const safe = (await safeNames([builderId]))(builderId, projectKey);
  return safe && safe !== PRIVATE_NAME ? safe : null;
}
/** A confirmed repo link as its key (owner/repo, lowercase). Pure. */
const repoOfUrl = (u: string) => u.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?github\.com\//, '').replace(/(\.git)?\/*$/, '');

/**
 * The wallet a coin's fees go to unless the builder names another: the newest proven one (v3.1 wallet proof: the reward
 * recipient, wallet-proof.ts provenWallet), else the group's first remembered one.
 */
export async function coinWallet(builderId: number): Promise<string | null> {
  const proven = await provenWallet(builderId);
  if (proven) return proven;
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
  deps: { check?: TickerCheck; late?: () => boolean } = {},
): Promise<{ line: string; wallet: string | null } | null> {
  if (!(await coinOfferable(builderId, projectKey))) return null;
  const [p] = await sql()<{ name: string; project_key: string }[]>`
    SELECT name, project_key FROM builder_projects WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) ORDER BY project_key LIMIT 1`;
  if (!p) return null;
  const { repo_url } = await confirmedLinks(builderId, p.project_key);
  const wallet = await coinWallet(builderId);
  // GTM W2: a private repo's coin is proposed from its public name only (never the repo's), and the line names it so.
  const hidden = await hiddenRepo(builderId, repo_url);
  const name = await coinName(builderId, p.project_key, p.name, repo_url, hidden);
  if (name === null) return null;
  const pair = hidden
    ? await proposeToken(name, deps.check ?? tokensFunTickerCheck, undefined)
    : await proposeToken(name, deps.check ?? tokensFunTickerCheck, repo_url ?? undefined, { ownEarnkit: await earnkitOwnRepo(builderId, repo_url) });
  const coin = { name: pair.name, symbol: pair.symbol };
  if (deps.late?.()) return null;
  if (!(await claimMoment(builderId, p.project_key, moment, wallet))) return null;
  await saveOffer(builderId, COIN_PROGRAM, offerKey(repo_url, p.name), coin, false, wallet);
  // The reply stopped waiting while the moment was claimed: release it (never spent unshown). The last step before return.
  if (deps.late?.()) {
    await sql()`DELETE FROM coin_moments WHERE builder_id = ${builderId} AND project_key = ${p.project_key} AND moment = ${moment} AND answer IS NULL`;
    return null;
  }
  return { line: coinLine(moment, name, wallet, coin), wallet };
}

/**
 * v3 Stage 2 (spec 5.3 Route 2): whether backing may be offered for this project now: EARNKIT_RAISING on, a coin
 * offerable (coinOfferable: launches available, not shared or held, never offered for it, no coin, under the declines,
 * a confirmed repo read public), never EarnKit's own repo (BACKING_EXCLUDED_REPOS), and a week of it approved by the
 * builder with code in it (project_updates facts.approved and hasFacts). A failed read is no.
 */
export async function backingOfferable(builderId: number, projectKey: string): Promise<boolean> {
  if (!raisingEnabled() || backingExcluded(projectKey)) return false;
  if (!(await coinOfferable(builderId, projectKey))) return false;
  return approvedCodeWeek(builderId, projectKey);
}

/** v3 Stage 2: a week of the project the builder approved, with code in it (project_updates facts.approved and hasFacts). */
export async function approvedCodeWeek(builderId: number, projectKey: string): Promise<boolean> {
  const rows = await sql()<{ facts: WeekFacts }[]>`
    SELECT facts FROM project_updates WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) AND NOT hidden
      AND COALESCE((facts->>'approved')::boolean, false)`;
  return rows.some((r) => hasFacts(r.facts ?? {}));
}

/**
 * v3 Stage 2: the backing offer (moment `first_week`), as offerCoin: the moment claimed (once a project), the name and
 * ticker proposed and saved as the shown offer, so the yes launches exactly it. Null when backingOfferable is not.
 * `late` (review fix): the reply stopped waiting; the moment is then never claimed (or is released), so it is offered later.
 */
export async function backingOffer(
  builderId: number,
  projectKey: string,
  deps: { check?: TickerCheck; late?: () => boolean } = {},
): Promise<{ line: string; wallet: string | null } | null> {
  if (!(await backingOfferable(builderId, projectKey))) return null;
  return offerCoin(builderId, projectKey, 'first_week', deps);
}

/**
 * R8 (tell token: 'ask'): an offer made and not answered yet, shown again as it was made: its moment's line,
 * the pair saved with it (proposed and saved now if none was) and the wallet it showed. Null when no open
 * offer (coinOpen) or the project is gone. The yes goes to coinYes as with the first showing.
 */
export async function openCoinLine(builderId: number, projectKey: string, deps: { check?: TickerCheck } = {}): Promise<{ line: string; wallet: string | null } | null> {
  const m = await momentOf(builderId, projectKey);
  if (!m || m.answer !== null || m.moment === 'built_live' || backingExcluded(m.project_key)) return null;
  const [p] = await sql()<{ name: string }[]>`SELECT name FROM builder_projects WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  if (!p) return null;
  const { repo_url } = await confirmedLinks(builderId, m.project_key);
  const key = offerKey(repo_url, p.name);
  const shown = await readShownOffer(builderId, COIN_PROGRAM, key);
  // GTM W2: a private repo's offer is shown again under its public name, never the repo's.
  const hidden = await hiddenRepo(builderId, repo_url);
  const name = await coinName(builderId, m.project_key, p.name, repo_url, hidden);
  if (name === null) return null;
  const coin = shown
    ? { name: shown.name, symbol: shown.symbol }
    : hidden
      ? await proposeToken(name, deps.check ?? tokensFunTickerCheck, undefined)
      : await proposeToken(name, deps.check ?? tokensFunTickerCheck, repo_url ?? undefined, { ownEarnkit: await earnkitOwnRepo(builderId, repo_url) });
  if (!shown) await saveOffer(builderId, COIN_PROGRAM, key, { name: coin.name, symbol: coin.symbol }, false, m.wallet);
  return { line: coinLine(m.moment, name, m.wallet, { name: coin.name, symbol: coin.symbol }), wallet: m.wallet };
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
  if (!m || m.answer === 'no' || m.moment === 'built_live' || backingExcluded(m.project_key)) return { show_to_builder: NOTED };
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
  // GTM W2: a repo not read public is named only by the project's public name in every line (never the repo's).
  const privateNow = !existing && (await hiddenRepo(builderId, links.repo_url));
  const lineName = await coinName(builderId, m.project_key, p.name, links.repo_url, privateNow);
  if (lineName === null) return { show_to_builder: COIN_NO_PUBLIC_NAME };
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
    return { show_to_builder: coinLine(m.moment, lineName, to, coin), agent_note: COIN_NOTE };
  };
  if (!shown) {
    const pair = privateNow
      ? await proposeToken(lineName, deps.check ?? tokensFunTickerCheck, undefined)
      : await proposeToken(lineName, deps.check ?? tokensFunTickerCheck, repoUrl ?? undefined, { ownEarnkit: await earnkitOwnRepo(builderId, repoUrl) });
    return again(given ?? m.wallet, { name: pair.name, symbol: pair.symbol });
  }
  const coin: Coin = { name: shown.name, symbol: shown.symbol };
  if (given && m.wallet && given !== m.wallet) return again(given, coin);
  // A wallet given when the line asked for one is the builder's answer to it. v3.1 wallet proof: with none, the wallet
  // the builder proved by signature (their reward recipient) is used, so COIN_WALLET_ASK is only for a builder without one.
  const to = given ?? m.wallet ?? (await provenWallet(builderId));
  if (!to) {
    await walletWait(builderId, m.project_key);
    return { show_to_builder: COIN_WALLET_ASK };
  }
  await walletWait(builderId, null);
  if (!m.wallet) await sql()`UPDATE coin_moments SET wallet = ${to} WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  // v2.13.3 review (I1), GTM W2 (2026-10-23): a repo not read public (private from the start, or it went private after
  // the offer): the coin carries only the project's public name (publicName), and the entry keeps the repo only for the
  // gate (the App reads it) and one-per-repo, marked repo_private, so tokens.fun never gets its link. No public name: no coin.
  if (privateNow && links.repo_url) {
    const safe = lineName;
    // The pair the line showed, when it was proposed from this name; else (the repo went private after the offer) a
    // fresh one from the name, shown before any yes.
    const fresh = await proposeToken(safe, deps.check ?? tokensFunTickerCheck, undefined);
    const hidden: Coin = fresh.name === coin.name ? coin : { name: fresh.name, symbol: fresh.symbol };
    if (hidden !== coin) return again(to, hidden);
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, creator_wallet, confirmed_at, confirm_choice, repo_private)
      VALUES (${COIN_PROGRAM}, ${safe}, ${links.repo_url}, ${links.live_url}, ${builderId}, ${to}, now(), 'go', true) RETURNING id`;
    if (raisingEnabled()) await sql()`UPDATE projects SET raising_at = COALESCE(raising_at, now()) WHERE id = ${id}`;
    await saveOffer(builderId, COIN_PROGRAM, offerKey(links.repo_url, safe), hidden, false, to);
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

/**
 * v3.1 cold read round 2: a coin yes is waiting for its fee wallet (standing_seen.coin_wallet_wait = the project key), or
 * not (null clears it). Never throws.
 */
async function walletWait(builderId: number, key: string | null): Promise<void> {
  await (key
    ? sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('coin_wallet_wait', ${key}::text) WHERE builder_id = ${builderId}`
    : sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'coin_wallet_wait' WHERE builder_id = ${builderId} AND standing_seen ? 'coin_wallet_wait'`
  ).catch((err: unknown) => console.error('[coin] wallet wait', err instanceof Error ? err.name : 'error'));
}
/** v3.1 cold read round 2: the project whose coin yes still waits for a fee wallet (its offer open, no wallet), else null. Never throws. */
export async function coinWalletWaiting(builderId: number): Promise<string | null> {
  const [r] = await sql()<{ key: string }[]>`
    SELECT m.project_key AS key FROM builder_profiles p JOIN coin_moments m ON m.builder_id = p.builder_id
      AND lower(m.project_key) = lower(p.standing_seen->>'coin_wallet_wait')
    WHERE p.builder_id = ${builderId} AND m.answer IS NULL AND m.wallet IS NULL`.catch(() => []);
  return r?.key ?? null;
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

/** v3.1 cold read: tell token: 'ask' when no coin can launch, one honest line each (never jargon). */
export const COIN_BLOCKED = {
  off: 'Coin launches are paused on EarnKit right now.',
  own: "EarnKit doesn't launch coins for its own code.",
  shared: 'This agent is shared by many people, so coins launch only from your own agent.',
  held: "Your page is under review, so a coin can't launch for it yet.",
} as const;

/**
 * v3.1 cold read: why no coin can launch for this project at all (the builder asked): launches off, EarnKit's own repo,
 * a shared agent, a held page; null when none of these holds. A failed read is the held line (fail strict). Never throws.
 */
export async function coinBlocked(builderId: number, projectKey: string): Promise<string | null> {
  if (!raisingEnabled() || !tokenLaunchesAvailable()) return COIN_BLOCKED.off;
  if (backingExcluded(projectKey)) return COIN_BLOCKED.own;
  try {
    if (await sharedGroup(builderId)) return COIN_BLOCKED.shared;
    const [p] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${builderId}`;
    return p && !p.held ? null : COIN_BLOCKED.held;
  } catch {
    return COIN_BLOCKED.held;
  }
}

/**
 * v3.1 cold read: the coin a project would launch (its name as offered and the proposed pair), without claiming or saving
 * anything, for the "goes public first" line. Null when the project has no row or no public name. Never throws.
 */
export async function coinPreview(builderId: number, projectKey: string, deps: { check?: TickerCheck } = {}): Promise<Coin | null> {
  try {
    const [p] = await sql()<{ name: string; project_key: string }[]>`
      SELECT name, project_key FROM builder_projects WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) ORDER BY project_key LIMIT 1`;
    if (!p) return null;
    const { repo_url } = await confirmedLinks(builderId, p.project_key);
    const hidden = await hiddenRepo(builderId, repo_url);
    const name = await coinName(builderId, p.project_key, p.name, repo_url, hidden);
    if (name === null) return null;
    const pair = hidden
      ? await proposeToken(name, deps.check ?? tokensFunTickerCheck, undefined)
      : await proposeToken(name, deps.check ?? tokensFunTickerCheck, repo_url ?? undefined, { ownEarnkit: await earnkitOwnRepo(builderId, repo_url) });
    return { name: pair.name, symbol: pair.symbol };
  } catch (err) {
    console.error('[coin] preview', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * v3.1 cold read: the builder asked for a coin (tell token: 'ask'), so an offer declined before is offered again: the
 * moment reopened (answer cleared) and its line shown as openCoinLine shows it; with no moment yet, the backing offer.
 * Every gate holds except the declines cap (coinOfferable asked: launches on, not shared or held, not EarnKit's own repo,
 * no coin yet, a confirmed repo, a public name, an approved week with code). Null otherwise. Never throws.
 */
export async function askedCoinOffer(
  builderId: number, projectKey: string, deps: { check?: TickerCheck } = {},
): Promise<{ line: string; wallet: string | null } | null> {
  try {
    const m = await momentOf(builderId, projectKey);
    if (!m) return await backingOffer(builderId, projectKey, deps);
    if (m.answer === 'yes' || m.moment === 'built_live') return null;
    if (!raisingEnabled() || !(await coinOfferable(builderId, projectKey, { asked: true })) || !(await approvedCodeWeek(builderId, projectKey))) return null;
    if (m.answer === 'no')
      await sql()`UPDATE coin_moments SET answer = NULL, answered_at = NULL WHERE builder_id = ${builderId} AND project_key = ${m.project_key} AND answer = 'no'`;
    return await openCoinLine(builderId, projectKey, deps);
  } catch (err) {
    console.error('[coin] asked offer', err instanceof Error ? err.name : 'error');
    return null;
  }
}
