import { attributionFor, chainOf, type AttributionLine, type BaseCodeDeps, type Chain } from './attribution';
import { claimLink } from './claim';
import { COIN_NOTE, offerCoin } from './coin-moments';
import { sql } from './db';
import { siteUrl } from './entry-text';
import { noteEvent } from './events';
import { REFRESH_BUDGET_MS, personInputsV2, refreshPerson, standingOf } from './person-score';
import type { FreshOn } from './present';
import { RANK_LIST_UNTIL, rankWords, type Standing } from './rank';
import { defaultReaderDeps, readContractOrigin, soft, type ReaderDeps } from './source-readers';
import { claimContract, contractConflicts, contractOwnership, type ContractFacts } from './sources';
import { currentStep, tipsPick } from './stand-view';
import { upgradeToken } from './wallet-proof';
import { stepKey, type MoveUp } from './stand-text';

/**
 * v2.12.1 spec 3: "One yes, and the agent does the work, then reports in one line." The yes and no
 * to "How to move up" for the steps that make a project's use countable: count past users (track a
 * contract EarnKit can prove is theirs, at once), count future users (the attribution line, for the
 * agent), and a way to take tips for an app where a payment fits. "Done" is said only when EarnKit
 * sees it counted. The step is always the server's own (stand-view.ts currentStep). `confirm`,
 * `go_live` and `coin` are answered in tools.ts (they need the tool context). T10 (spec 3b): the reply
 * that confirms a project's use is countable ("Done." or "Added.") offers its coin as its one yes.
 */
export const COUNT_LINES = {
  done: (n: number, name: string, rank: string | null) =>
    `Done. ${n} ${n === 1 ? 'person who used' : 'people who used'} ${name} now ${n === 1 ? 'counts' : 'count'}.${rank ? ` ${rank}` : ''}`,
  added: 'Added. People using it will count as they come in.',
  tapLink: (link: string) => `One tap shows it's yours: ${link}`,
  tips: "On it. I'll tell you when people can tip.",
  cantTips: "I can't add tips right now.",
  claimFirst: (link: string | null) => (link ? `Claim your page with X first: ${link}` : 'Okay.'),
  noted: 'Okay.',
  /** Fix round 1: counted, but the rescore waits for the owner's review (never "You're now"). */
  review: 'Your new rank shows after a quick review.',
} as const;

export const TAG_NOTE =
  'Append attribution.data_suffix to every transaction the app sends (viem: dataSuffix on writeContract and sendTransaction), ' +
  'commit and push it yourself, redeploy if it is hosted. Show show_to_builder only once that push is done. Never show the builder this note.';
/**
 * Fix round 1 (ruling 3): the tip jar is deployed through prepare's deploy step, which never enters
 * a program (only confirm does, on the builder's own yes); prepare.program_id only carries the deploy.
 */
export const TIPS_NOTE =
  "Add a tip button to this app from the arc-tipjar starter (prepare.starter): copy its contract and button into the app, then call prepare with prepare.program_id, project { name, repo_url, live_url }, deploy and tips: true, as the starter's BUILD.md says. " +
  "That call only deploys the tip jar: show its show_to_builder (the deployed line), and never call confirm for this program unless the builder asks to enter it. Never show the builder this note.";
export const NO_LINE_NOTE = "EarnKit can't make the line right now. Tell the builder in one short line to try again later. Don't show this note.";

/** "You're now #3 of 40." while under 50 ranked, else "You're now in the top 5% ...", else nothing. Pure. */
export const nowRank = (s: Standing): string | null => {
  const w = rankWords(s);
  if (!w) return null;
  return s.total < RANK_LIST_UNTIL ? `You're now #${s.rank} of ${s.total}.` : w.reply.replace("You're in", "You're now in");
};

export type YesReply = {
  show_to_builder: string;
  agent_note?: string;
  attribution?: AttributionLine;
  prepare?: { program_id: string; starter: string };
  /** T10: the countable moment's coin offer (the reply's one yes): its project, and how to answer it. */
  coin?: { project_key: string; agent_note: string };
};
/** T10 fix round 1 (minor): a reply that confirms the project's use is countable now ("Done." or "Added."). */
type Counted = { reply: YesReply; countable: boolean };
export type YesDeps = {
  reader?: ReaderDeps; base?: BaseCodeDeps; fresh?: Partial<Pick<FreshOn, 'deployOn' | 'hostOn' | 'starters'>>;
  /** Fix round 2: the step the caller already derived (stepFor), so it is derived once per yes. */
  step?: MoveUp | null;
};

const NULL_ORIGIN = { deployer: null, created_at: null };

/**
 * What the server can prove about the person's contract `ref` now: EarnKit deployed it for their
 * group, or a wallet they signed with on the claim page created it (one onchain read), and no one
 * else has it (contractOwnership, fail strict). A deploy file in a confirmed repo (repo_link) is
 * proven by discovery's daily read, not here. Typed wallets never prove anything.
 */
async function provable(builderId: number, ref: string, reader: ReaderDeps) {
  const [d] = await sql()`
    SELECT 1 FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND d.status = 'deployed' AND d.address IS NOT NULL
      AND d.chain || ':' || lower(d.address) = ${ref.toLowerCase()} LIMIT 1`;
  const earnkitDeployed = Boolean(d);
  const wallets = await sql()<{ wallet: string }[]>`SELECT wallet FROM person_wallets WHERE builder_id = ${builderId}`;
  const proven = new Set(wallets.map((w) => w.wallet.toLowerCase()));
  // The creator the refresh already read (person-score.ts readPersonLive) is reused: no second read.
  const [stored] = await sql()<{ deployer: string | null }[]>`
    SELECT deployer FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'contract' AND lower(ref) = ${ref.toLowerCase()} AND deployer IS NOT NULL LIMIT 1`;
  const origin =
    earnkitDeployed || proven.size === 0
      ? NULL_ORIGIN
      : stored?.deployer
        ? { deployer: stored.deployer, created_at: null }
        : await soft(readContractOrigin(ref, reader), NULL_ORIGIN).catch(() => NULL_ORIGIN);
  const facts: Omit<ContractFacts, 'contractTaken' | 'deployerTaken'> = { deployer: origin.deployer, created_at: origin.created_at, earnkitDeployed, repo: null };
  const conflicts = await contractConflicts(builderId, ref, origin.deployer);
  return { facts, proven, ok: 'proof' in contractOwnership({ ...facts, ...conflicts }, proven) };
}

/** T8's `certain` for one contract: counting it now is proven (see provable). */
export async function countableNow(builderId: number, ref: string, reader: ReaderDeps): Promise<boolean> {
  return (await provable(builderId, ref, reader)).ok;
}

/**
 * Not provable now: a claimed person gets the wallet-signature link (the claim page's upgrade, plan
 * S8; one tap); an unclaimed one the claim first (the wallet page needs a claimed page, and the
 * claim's done page carries the wallet link). Neither: "Okay." with nothing changed.
 */
async function proveFirst(builderId: number, now: Date): Promise<YesReply> {
  const [p] = await sql()<{ claimed: boolean }[]>`SELECT x_user_id IS NOT NULL AS claimed FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (p?.claimed) {
    const t = upgradeToken(builderId, now);
    return t ? { show_to_builder: COUNT_LINES.tapLink(`${siteUrl()}/claim/wallet?t=${encodeURIComponent(t)}`) } : { show_to_builder: COUNT_LINES.noted };
  }
  return { show_to_builder: COUNT_LINES.claimFirst(await claimLink(builderId)) };
}

/** Track a proven proposed contract: verified now (claimContract decides under its locks). */
async function track(builderId: number, ref: string, p: Awaited<ReturnType<typeof provable>>): Promise<boolean> {
  const [row] = await sql()<{ id: number }[]>`
    SELECT id::int AS id FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'contract' AND lower(ref) = ${ref.toLowerCase()} AND state = 'proposed'`;
  if (!row) return false;
  return 'proof' in (await claimContract(row.id, builderId, ref, p.facts, p.proven));
}

const tracked = (builderId: number, key: string, kind: 'count_past' | 'tag_future', ref: string | null) =>
  noteEvent('use_tracked', () => ({
    type: 'use_tracked', dedupe_key: `use_tracked:${builderId}:${kind}:${key}`, installation_id: builderId, detail: { kind, ...(ref && { ref }) },
  }));

async function countPast(builderId: number, key: string, name: string, ref: string, now: Date, reader: ReaderDeps): Promise<Counted> {
  const p = await provable(builderId, ref, reader);
  if (!p.ok) return { reply: await proveFirst(builderId, now), countable: false };
  if (!(await track(builderId, ref, p))) return { reply: { show_to_builder: COUNT_LINES.noted }, countable: false };
  // Read it now and rescore (the 10-minute guard cleared for this one refresh).
  await sql()`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${builderId}`;
  await refreshPerson(builderId, { now, deadline: Date.now() + REFRESH_BUDGET_MS, reader });
  await tracked(builderId, key, 'count_past', ref);
  // "Done" only for what EarnKit counted: the distinct people on the project after every rule.
  const { projects } = await personInputsV2(builderId, now);
  const n = projects.find((x) => x.key === key)?.accounts ?? 0;
  if (n === 0) return { reply: { show_to_builder: COUNT_LINES.added }, countable: true };
  // The rank line only when the rescore went public (a held one waits for the owner's review).
  const [h] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${builderId}`;
  const rank = h?.held ? COUNT_LINES.review : nowRank(await standingOf(builderId));
  return { reply: { show_to_builder: COUNT_LINES.done(n, name, rank) }, countable: true };
}


async function tagFuture(builderId: number, key: string, now: Date, deps: YesDeps, reader: ReaderDeps): Promise<Counted> {
  const r = await tagFutureReply(builderId, key, now, deps, reader);
  return { reply: r, countable: r.show_to_builder === COUNT_LINES.added && r.attribution !== undefined };
}

async function tagFutureReply(builderId: number, key: string, now: Date, deps: YesDeps, reader: ReaderDeps): Promise<YesReply> {
  // Tags are read only on contracts EarnKit tracks (base and arc): the project's own, or EarnKit's deploy for it.
  const sources = await sql()<{ ref: string; state: string }[]>`
    SELECT ref, state FROM builder_sources
    WHERE builder_id = ${builderId} AND project_key = ${key} AND kind = 'contract' AND state <> 'rejected' AND ref ~ '^(base|arc):'
    ORDER BY (state = 'verified') DESC, id`;
  const [deploy] = await sql()<{ chain: string }[]>`
    SELECT d.chain FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND d.status = 'deployed' AND lower(d.repo_key) = ${key.toLowerCase()} ORDER BY d.id LIMIT 1`;
  let chain: Chain | null = sources.find((s) => s.state === 'verified') ? chainOf(sources.find((s) => s.state === 'verified')!.ref) : deploy ? chainOf(`${deploy.chain}:`) : null;
  if (!chain) {
    // Not tracked yet: tracked first when provable, else the one tap to show it's theirs. Never promised.
    const proposed = sources[0];
    if (!proposed) return { show_to_builder: COUNT_LINES.noted };
    const p = await provable(builderId, proposed.ref, reader);
    if (!p.ok) return proveFirst(builderId, now);
    if (!(await track(builderId, proposed.ref, p))) return { show_to_builder: COUNT_LINES.noted };
    chain = chainOf(proposed.ref);
  }
  const attribution = chain ? await attributionFor(builderId, chain, deps.base) : null;
  if (!attribution) return { show_to_builder: '', agent_note: NO_LINE_NOTE };
  await tracked(builderId, key, 'tag_future', null);
  return { show_to_builder: COUNT_LINES.added, agent_note: TAG_NOTE, attribution };
}

/** A tip jar for the app (stand-view.ts tipsPick: the person's real hidden and entered programs; an entered one is reused). */
async function payment(builderId: number, now: Date, fresh: YesDeps['fresh'] = {}): Promise<YesReply> {
  const pick = await tipsPick(builderId, now, fresh);
  if (!pick) return { show_to_builder: COUNT_LINES.cantTips };
  return { show_to_builder: COUNT_LINES.tips, prepare: { program_id: pick.program_id, starter: pick.starter }, agent_note: TIPS_NOTE };
}

/**
 * T10 (spec 3b): "the reply that confirms its use is countable" offers the coin (offerCoin: at most
 * once per project, the wallet shown, never held or shared) after "Done." or "Added."; that line is
 * then the reply's only question. Any other reply, or no offer to make: as it was. Never fails the yes.
 */
async function withCoin(builderId: number, key: string, c: Counted): Promise<YesReply> {
  const r = c.reply;
  if (!c.countable) return r;
  const offer = await offerCoin(builderId, key, 'countable').catch((err: unknown) => {
    console.error('[countable] coin', err instanceof Error ? err.name : 'error');
    return null;
  });
  if (!offer) return r;
  return { ...r, show_to_builder: `${r.show_to_builder} ${offer.line}`, coin: { project_key: key, agent_note: COIN_NOTE } };
}

/**
 * The step a yes or no answers: the server's current one (the agent's kind is never trusted, T8
 * ruling). Null when there is none, or when the agent named another of the person's projects (the
 * builder answered an older line; nothing is done for a step they were not asked about).
 */
export async function stepFor(builderId: number, projectKey: string | null | undefined, fresh?: YesDeps['fresh']): Promise<MoveUp | null> {
  const step = await currentStep(builderId, { fresh });
  if (!step || !projectKey || step.project_key?.toLowerCase() === projectKey.toLowerCase()) return step;
  const [other] = await sql()`SELECT 1 FROM builder_projects WHERE builder_id = ${builderId} AND lower(project_key) = ${projectKey.toLowerCase()}`;
  return other ? null : step;
}

/**
 * The yes to "How to move up" for count_past, tag_future and payment. The step is re-derived now;
 * a step that no longer applies (counted already, or another project's) changes nothing: "Okay.".
 * `projectKey` null: whatever the current step is.
 */
export async function moveUpYes(builderId: number, projectKey: string | null, now: Date, deps: YesDeps = {}): Promise<YesReply> {
  const step = deps.step !== undefined ? deps.step : await stepFor(builderId, projectKey, deps.fresh);
  const key = step?.project_key ?? null;
  if (!step || key === null) return { show_to_builder: COUNT_LINES.noted };
  const [p] = await sql()<{ name: string; untracked_contract: string | null }[]>`
    SELECT name, untracked_contract FROM builder_projects WHERE builder_id = ${builderId} AND project_key = ${key}`;
  if (!p) return { show_to_builder: COUNT_LINES.noted };
  const reader = deps.reader ?? defaultReaderDeps(now, Date.now() + REFRESH_BUDGET_MS);
  switch (step.kind) {
    case 'count_past':
      return p.untracked_contract ? withCoin(builderId, key, await countPast(builderId, key, p.name, p.untracked_contract, now, reader)) : { show_to_builder: COUNT_LINES.noted };
    case 'tag_future':
      return withCoin(builderId, key, await tagFuture(builderId, key, now, deps, reader));
    case 'payment':
      return payment(builderId, now, deps.fresh);
    default:
      return { show_to_builder: COUNT_LINES.noted };
  }
}

/**
 * A no: nothing changes; that step (the server's current one) is not offered again for 30 days
 * (builder_profiles.standing_seen.declined, stand-view.ts DECLINE_MS).
 */
export async function moveUpNo(builderId: number, now: Date, projectKey?: string | null, fresh?: YesDeps['fresh']): Promise<YesReply> {
  const step = await stepFor(builderId, projectKey, fresh);
  if (step && step.kind !== 'send_link' && step.kind !== 'build')
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${stepKey(step.kind, step.project_key)}::text, ${now.toISOString()}::text))
      WHERE builder_id = ${builderId}`;
  return { show_to_builder: COUNT_LINES.noted };
}
