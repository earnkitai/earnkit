import { sql } from './db';
import { newProgramOf, openCuratedRows, programVerdict } from './alerts';
import { readFitRepos } from './installations';
import { showable, type Seen } from './stand-view';
import { creditsMainnet, type Detection, type Verdict } from './match';
import { CHAIN_NAMES, type Chain } from './chains';
import type { Card } from './present';
import { BASE_GRANTS_ID } from './builder-code';
import { appProvenRepo, builderCodesKnown, refreshBuilderCodes } from './builder-codes-check';
import { QUALIFY_STEPS, awardAmount, benchStepKey, grantProgramName, type OpenGrant, type QualifyOffer, type QualifyStep } from './bench-reply';

/**
 * 2026-10-22 (owner-approved reply fix 3): a ranked builder with no program fit hears the path to Base Builder Grants
 * instead of "Want me to suggest one small thing to ship?". The steps come only from the program file's rules (build on
 * Base; Builder Codes, "the first step to be eligible"; a live product that's getting used), and which of them are
 * missing only from the matcher's own verdict for the pair (match.ts matchRepo, as alerts.ts reads the remembered repo)
 * and the stored Builder Codes answer. A step is dropped only when known met; it is named missing only when known
 * missing. Never a claim of eligibility.
 */

/** A program's grant as the copy names it: its organizer (no parenthesis), award and one chain's name. Null without an award. Pure. */
export function grantOf(c: Pick<Card, 'organizer' | 'max_award_usd' | 'investment' | 'chains' | 'any_chain'> & { title?: string | null }): OpenGrant | null {
  const amount = awardAmount(c);
  const org = c.organizer?.replace(/\s*\([^)]*\)/g, '').trim();
  if (!amount || !org) return null;
  const one = c.any_chain !== true && c.chains?.length === 1 ? c.chains[0] : null;
  // v3.1 cold read: the hook names the program ("Base Builder Grants pay up to ..."), not only its organizer.
  return { org, amount, chain: one ? (Object.hasOwn(CHAIN_NAMES, one) ? CHAIN_NAMES[one as Chain] : one) : null, ...(c.title?.trim() && { name: grantProgramName(c.title) }) };
}

type Status = 'met' | 'missing' | 'unknown';
/**
 * Each step's status from the matcher's verdict for Base Builder Grants (`v`; null: no row), the facts it read
 * (`chains`; null: the repo was never matched) and the Builder Codes answer (`codes`; null: unknown). Pure.
 * - base: a deploy the matcher credits on Base (no `mainnet_deploy` missing) is met; Base not credited is missing.
 * - use: a likely verdict is met; `live_url` or `real_users` missing is missing; else unknown.
 * - codes: the stored answer.
 */
export function qualifyStatus(m: { v: Verdict | null; chains: Detection } | null, codes: boolean | null, onBaseSaid = false, usersSaid = false): Record<QualifyStep, Status> {
  // v3.1 GTM W3: a builder whose contracts are on Base (confirmed, or reported by the agent or the builder:
  // `onBaseSaid`) is never told "Put your app on Base."; the matcher's word only adds to that.
  const onBase = onBaseSaid ? 'met' : m === null ? 'unknown' : !m.v?.missing.includes('mainnet_deploy') && creditsMainnet(m.chains.base) ? 'met' : 'missing';
  // v3.1 cold read: users or a live app reported or known (`usersSaid`) is never told "Have a live product people use.".
  const use = usersSaid || m?.v?.status === 'likely' ? 'met' : m?.v?.missing.some((x) => x === 'live_url' || x === 'real_users') ? 'missing' : 'unknown';
  return { base: onBase, codes: codes === null ? 'unknown' : codes ? 'met' : 'missing', use };
}

/**
 * v3.1 GTM W3: whether `key`'s project is known on Base: its row's chains (a confirmed contract, an EarnKit deploy, a
 * coin) or a contract the agent reported on Base (a non-rejected builder_sources contract "base:0x..."). Never throws.
 */
export async function onBaseKnown(id: number, key: string): Promise<boolean> {
  const [r] = await sql()<{ on: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM builder_projects WHERE builder_id = ${id} AND lower(project_key) = lower(${key}) AND 'base' = ANY(chains))
      OR EXISTS (SELECT 1 FROM builder_sources WHERE builder_id = ${id} AND lower(project_key) = lower(${key}) AND kind = 'contract'
        AND state <> 'rejected' AND ref ILIKE 'base:%') AS on`.catch(() => [{ on: false }]);
  return r?.on === true;
}

/**
 * v3.1 cold read: whether `key`'s project is known live or used: a site (verified or reported), a live app row (shipped app), or users
 * the builder reported (builder_repo_facts has_users). A failed read is false. Never throws.
 */
export async function liveOrUsersKnown(id: number, key: string): Promise<boolean> {
  const [r] = await sql()<{ yes: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM builder_sources WHERE builder_id = ${id} AND lower(project_key) = lower(${key}) AND kind = 'site' AND state <> 'rejected')
      OR EXISTS (SELECT 1 FROM builder_projects WHERE builder_id = ${id} AND lower(project_key) = lower(${key}) AND shipped AND kind = 'app')
      OR EXISTS (SELECT 1 FROM builder_repo_facts WHERE installation_id = ${id} AND lower(repo_key) = lower(${key}) AND (has_users OR live_url IS NOT NULL)) AS yes`.catch(() => [{ yes: false }]);
  return r?.yes === true;
}

/** The offer's steps from their statuses: null when every step is known met (never a "you qualify"). Pure. */
export function qualifyPlan(grant: OpenGrant, st: Record<QualifyStep, Status>): QualifyOffer | null {
  const steps = QUALIFY_STEPS.filter((s) => st[s] !== 'met');
  if (steps.length === 0) return null;
  return { program_id: BASE_GRANTS_ID, grant, missing: steps.filter((s) => st[s] === 'missing'), steps };
}

/**
 * The offer for a ranked builder's one project `key` with no fit: Base Builder Grants open and shown (`cards`, not in
 * `skip`), with an award; not declined within `declineMs`; never a program the builder told EarnKit about. Null
 * otherwise or on a read error (the reply keeps the ship step). Never throws.
 */
export async function qualifyOffer(
  id: number,
  key: string,
  o: {
    cards: Card[]; skip: Set<string>; seen: Seen & { qualify_given?: Record<string, string> }; now: Date; declineMs: number; codesFetch?: typeof fetch;
    /** v3.1 cold read: what this reply's own match read of the project (a Base deploy, a live link). */
    known?: { onBase: boolean; live: boolean };
  },
): Promise<QualifyOffer | null> {
  try {
    const card = o.cards.find((c) => c.id === BASE_GRANTS_ID);
    if (!card || !showable(card, o.now, o.skip)) return null;
    const grant = grantOf(card);
    if (!grant) return null;
    // A no, or a yes (the steps were given: fix round 1), keeps the question away for declineMs.
    const no = o.seen.declined?.[benchStepKey('qualify', key)];
    if (no && o.now.getTime() - Date.parse(no) < o.declineMs) return null;
    const given = o.seen.qualify_given?.[key.toLowerCase()];
    if (given && o.now.getTime() - Date.parse(given) < o.declineMs) return null;
    const [told] = await sql()`SELECT 1 FROM builder_program_status WHERE installation_id = ${id} AND program_id = ${BASE_GRANTS_ID} LIMIT 1`;
    if (told) return null;
    const [repos, rows] = await Promise.all([readFitRepos(id), openCuratedRows()]);
    const row = rows.find((r) => r.id === BASE_GRANTS_ID);
    if (!row) return null;
    const repo = repos.find((r) => r.key.toLowerCase() === key.toLowerCase());
    const m = repo ? programVerdict(newProgramOf(row), repo) : null;
    // Fix round 1: the Builder Codes answer, and for an App-proven repo a check started in the background (never awaited;
    // once a day per repo through the attempts table), so "I check your code for Builder Codes" is true for this builder.
    let codes: boolean | null = null;
    if (await appProvenRepo(id, key)) {
      const known = await builderCodesKnown(key, o.now);
      refreshBuilderCodes(id, key, known, o.now, o.codesFetch);
      codes = known?.found ?? null;
    }
    const usersSaid = o.known?.live === true || repo?.said?.has_users === true || Boolean(repo?.said?.live_url) || (await liveOrUsersKnown(id, key));
    const onBase = o.known?.onBase === true || creditsMainnet(repo?.chains?.base) || Boolean(repo?.said?.mainnet.includes('base')) || (await onBaseKnown(id, key));
    return qualifyPlan(grant, qualifyStatus(m, codes, onBase, usersSaid));
  } catch (err) {
    console.error('[bench] qualify', err instanceof Error ? err.name : 'error');
    return null;
  }
}
