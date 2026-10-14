import { repoKey } from './answer-bank';
import { builderScoreEnabled } from './builder-score-flag';
import { isWalletAddress } from './campaigns';
import { sql } from './db';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';
import { DECLINES_MAX, offerIdentity, offerKey, recordDecline, saveOffer } from './token-offers';
import { proposeToken, tokensFunTickerCheck, type TickerCheck } from './token-proposal';
import { tokenLaunchesAvailable } from './tokens';

/**
 * v2.12.1 spec 3b: the token is offered as that reply's one yes only at these moments: built
 * through EarnKit (the reply that confirms the app is live and counting), an existing project made
 * countable or reaching its first 5 people, or a project with people and no coin when no bigger
 * step exists. At most once per project; never again after DECLINES_MAX declines; the wallet shown
 * before the yes; never for shared clients or held profiles. It replaces v2.12's score-20 gate.
 */
import { COIN_PROGRAM } from './policy-constants';

export { COIN_PROGRAM };
export type Moment = 'built_live' | 'countable' | 'first_five' | 'has_people';

const fees = (wallet: string | null) =>
  wallet ? `You'd get 40% of its trading fees, paid to ${shortWallet(wallet.toLowerCase())}.` : "You'd get 40% of its trading fees. Send me the wallet they should go to.";

/** The offer line for a moment, the wallet shown (or asked for) in it. Pure. */
export function coinLine(moment: Moment, name: string, wallet: string | null): string {
  if (moment === 'built_live') return `It's live. Want to launch a coin for it? ${fees(wallet)}`;
  if (moment === 'first_five') return `5 people have used ${name}. Want to launch a coin for it? ${fees(wallet)}`;
  if (moment === 'countable') return `Want to launch a coin for ${name}? ${fees(wallet)}`;
  return `${name} has people using it. Want to launch a coin for it? ${fees(wallet)}`;
}

/** The builder's line when a coin yes came without a wallet and none is known. */
export const COIN_WALLET_ASK = 'Send me the wallet the fees should go to.';
const NOTED = 'Okay.';

/** The agent's note with a coin offer (find's move_up, a countable reply): how to pass the answer. */
export const COIN_NOTE =
  "The last line offers a coin. When the builder says yes, call tell with coin: { project_key, answer: 'yes' } (add wallet: the address they gave, if they gave one); " +
  "when they say no, answer: 'no'. Never launch anything before that yes.";
/** coinYes's note: the confirm call that launches it. */
export const COIN_YES_NOTE =
  'Call confirm with project_id, yes: true, wallet and token exactly as given. The usual token steps follow (the proof line on the repo).';

/** Not shared, a profile, not held (fail strict: no profile is no). */
async function guards(builderId: number): Promise<boolean> {
  if (!builderScoreEnabled() || (await sharedGroup(builderId))) return false;
  const [p] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${builderId}`;
  return Boolean(p) && !p.held;
}

/**
 * Whether a coin may be offered for this project now: the flag on, launches available, not a
 * shared group, a profile that isn't held, never offered for this project before, the project has
 * no coin (none on its page, none launched through EarnKit for it), and fewer than DECLINES_MAX
 * coin offers declined.
 */
export async function coinAllowed(builderId: number, projectKey: string): Promise<boolean> {
  if (!builderScoreEnabled() || !tokenLaunchesAvailable() || (await sharedGroup(builderId))) return false;
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
  return r?.ok === true;
}

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

/** Records the moment (at most once per project). True when this call recorded it. */
async function claimMoment(builderId: number, key: string, moment: Moment): Promise<boolean> {
  const rows = await sql()`
    INSERT INTO coin_moments (builder_id, project_key, moment) VALUES (${builderId}, ${key}, ${moment})
    ON CONFLICT (builder_id, project_key) DO NOTHING RETURNING 1`;
  if (rows.length === 0) return false;
  await offered(builderId, key, moment);
  return true;
}

/**
 * The offer at one of the 3b moments: its line (the wallet shown, or asked for) and the wallet, or
 * null when it may not be offered (coinAllowed) or was offered already. Records the moment.
 */
export async function offerCoin(builderId: number, projectKey: string, moment: Moment): Promise<{ line: string; wallet: string | null } | null> {
  if (!(await coinAllowed(builderId, projectKey))) return null;
  const [p] = await sql()<{ name: string; project_key: string }[]>`
    SELECT name, project_key FROM builder_projects WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) ORDER BY project_key LIMIT 1`;
  if (!p) return null;
  const wallet = await coinWallet(builderId);
  if (!(await claimMoment(builderId, p.project_key, moment))) return null;
  return { line: coinLine(moment, p.name, wallet), wallet };
}

type MomentRow = { project_key: string; moment: Moment; answer: 'yes' | 'no' | null; project_id: number | null };
const momentOf = async (builderId: number, projectKey: string) =>
  (await sql()<MomentRow[]>`
    SELECT project_key, moment, answer, project_id FROM coin_moments WHERE builder_id = ${builderId} AND lower(project_key) = lower(${projectKey}) LIMIT 1`)[0] ?? null;

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

/**
 * The yes to a coin offer: one entry in the internal coin program (the project's own name and
 * confirmed links, the wallet), the pair EarnKit proposes for it, saved as the shown offer (with
 * the wallet) so confirm by project_id launches exactly it. Only for an offer made and not
 * declined; a repeat yes reuses the same entry. No wallet given or known: the builder is asked.
 */
export async function coinYes(
  builderId: number,
  projectKey: string,
  wallet: string | null,
  deps: { check?: TickerCheck } = {},
): Promise<{ project_id: number; token: { name: string; symbol: string }; wallet: string | null; agent_note: string } | { show_to_builder: string }> {
  if (!(await guards(builderId))) return { show_to_builder: NOTED };
  const m = await momentOf(builderId, projectKey);
  if (!m || m.answer === 'no') return { show_to_builder: NOTED };
  const [p] = await sql()<{ name: string }[]>`SELECT name FROM builder_projects WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  if (!p) return { show_to_builder: NOTED };
  const given = wallet && isWalletAddress(wallet.trim()) ? wallet.trim().toLowerCase() : null;
  const to = given ?? (await coinWallet(builderId));
  if (!to) return { show_to_builder: COIN_WALLET_ASK };
  const links = await confirmedLinks(builderId, m.project_key);
  const [existing] = m.project_id
    ? await sql()<{ id: number; repo_url: string | null }[]>`
        SELECT id, repo_url FROM projects WHERE id = ${m.project_id} AND installation_id = ${builderId} AND program_id = ${COIN_PROGRAM}`
    : [];
  const projectId = existing
    ? existing.id
    : (
        await sql()<{ id: number }[]>`
          INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, creator_wallet, confirmed_at, confirm_choice)
          VALUES (${COIN_PROGRAM}, ${p.name}, ${links.repo_url}, ${links.live_url}, ${builderId}, ${to}, now(), 'go') RETURNING id`
      )[0].id;
  if (existing) await sql()`UPDATE projects SET creator_wallet = ${to} WHERE id = ${projectId} AND token_url IS NULL`;
  const repoUrl = existing ? existing.repo_url : links.repo_url;
  const pair = await proposeToken(p.name, deps.check ?? tokensFunTickerCheck, repoUrl ?? undefined);
  const token = { name: pair.name, symbol: pair.symbol };
  await saveOffer(builderId, COIN_PROGRAM, offerKey(repoUrl, p.name), token, false, to);
  await sql()`
    UPDATE coin_moments SET answer = 'yes', answered_at = COALESCE(answered_at, now()), project_id = ${projectId}
    WHERE builder_id = ${builderId} AND project_key = ${m.project_key}`;
  await noteEvent('coin_answered', () => ({
    type: 'coin_answered', dedupe_key: `coin_answered:${builderId}:${m.project_key.toLowerCase()}`, installation_id: builderId, project_id: projectId, detail: { answer: 'yes', moment: m.moment },
  }));
  return { project_id: projectId, token, wallet: to, agent_note: COIN_YES_NOTE };
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
 * Whether this entry's confirm may pitch (and launch) a token. Flag off: always (v2.11). The coin
 * program's own entry: yes (its moment was shown). The build path's entry (`build`: the
 * installation's build names this program and repo): the built_live moment, recorded at the first
 * reply that pitches it (coinAllowed), and open until the builder declines it. Any other entry:
 * never ("nowhere else"); EarnKit campaign entries are exempt at their call sites.
 */
export async function coinPitchAllowed(builderId: number, entry: { program_id: string; build: boolean; project_key?: string }): Promise<boolean> {
  if (!builderScoreEnabled()) return true;
  if (entry.program_id === COIN_PROGRAM) return true;
  if (!entry.build) return false;
  const key = entry.project_key ?? entry.program_id;
  const m = await momentOf(builderId, key);
  if (m) return m.moment === 'built_live' && m.answer !== 'no' && (await guards(builderId));
  if (!(await coinAllowed(builderId, key))) return false;
  await claimMoment(builderId, key, 'built_live');
  return true;
}

/**
 * The build entry's answer to its built_live coin (confirm's yes with a token, or skip the token):
 * recorded once, as coinYes and coinNo record theirs (a no counts toward DECLINES_MAX).
 */
export async function builtLiveAnswer(builderId: number, projectKey: string, answer: 'yes' | 'no', projectId?: number): Promise<void> {
  if (!builderScoreEnabled()) return;
  const m = await momentOf(builderId, projectKey);
  if (!m || m.moment !== 'built_live' || m.answer !== null) return;
  const updated = await sql()`
    UPDATE coin_moments SET answer = ${answer}, answered_at = now(), project_id = ${projectId ?? null}
    WHERE builder_id = ${builderId} AND project_key = ${m.project_key} AND answer IS NULL RETURNING 1`;
  if (updated.length > 0)
    await noteEvent('coin_answered', () => ({
      type: 'coin_answered', dedupe_key: `coin_answered:${builderId}:${m.project_key.toLowerCase()}`, installation_id: builderId,
      ...(projectId && { project_id: projectId }), detail: { answer, moment: 'built_live' },
    }));
}
