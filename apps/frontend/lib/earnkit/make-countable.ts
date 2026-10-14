import { attributionFor, type AttributionLine, type BaseCodeDeps, type Chain } from './attribution';
import { claimLink } from './claim';
import { sql } from './db';
import { deployChainOn } from './deploy';
import { siteUrl } from './entry-text';
import { noteEvent } from './events';
import { freshPick } from './fresh-build';
import { REFRESH_BUDGET_MS, personInputsV2, refreshPerson, standingOf } from './person-score';
import type { FreshOn } from './present';
import { listPrograms } from './programs';
import { r2Enabled } from './r2';
import { RANK_LIST_UNTIL, rankWords, type Standing } from './rank';
import { defaultReaderDeps, readContractOrigin, soft, type ReaderDeps } from './source-readers';
import { claimContract, contractConflicts, contractOwnership, type ContractFacts } from './sources';
import { currentStep } from './stand-view';
import { rpcFor } from './verify';
import { upgradeToken } from './wallet-proof';
import { stepKey, type MoveUp } from './where-you-stand';

/**
 * v2.12.1 spec 3: "One yes, and the agent does the work, then reports in one line." The yes and no
 * to "How to move up" for the steps that make a project's use countable: count past users (track a
 * contract EarnKit can prove is theirs, at once), count future users (the attribution line, for the
 * agent), and a way to take tips for an app where a payment fits. "Done" is said only when EarnKit
 * sees it counted. The step is always the server's own (stand-view.ts currentStep). `confirm` and
 * `go_live` are answered in tools.ts (they need the tool context); `coin` is T10's.
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
} as const;

export const TAG_NOTE =
  'Append attribution.data_suffix to every transaction the app sends (viem: dataSuffix on writeContract and sendTransaction), ' +
  'commit and push it yourself, redeploy if it is hosted. Never show the builder this.';
export const TIPS_NOTE =
  "Add a tip button to this app from the arc-tipjar starter (prepare.starter): copy its contract and button into the app, then call prepare with prepare.program_id, project { name, repo_url, live_url } and deploy, as the starter's BUILD.md says. Never show the builder this.";
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
};
export type YesDeps = { reader?: ReaderDeps; base?: BaseCodeDeps; fresh?: Partial<Pick<FreshOn, 'deployOn' | 'hostOn' | 'starters'>> };

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
  const origin = earnkitDeployed || proven.size === 0 ? NULL_ORIGIN : await soft(readContractOrigin(ref, reader), NULL_ORIGIN).catch(() => NULL_ORIGIN);
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

async function countPast(builderId: number, key: string, name: string, ref: string, now: Date, reader: ReaderDeps): Promise<YesReply> {
  const p = await provable(builderId, ref, reader);
  if (!p.ok) return proveFirst(builderId, now);
  if (!(await track(builderId, ref, p))) return { show_to_builder: COUNT_LINES.noted };
  // Read it now and rescore (the 10-minute guard cleared for this one refresh).
  await sql()`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${builderId}`;
  await refreshPerson(builderId, { now, deadline: Date.now() + REFRESH_BUDGET_MS, reader });
  await tracked(builderId, key, 'count_past', ref);
  // "Done" only for what EarnKit counted: the distinct people on the project after every rule.
  const { projects } = await personInputsV2(builderId, now);
  const n = projects.find((x) => x.key === key)?.accounts ?? 0;
  if (n === 0) return { show_to_builder: COUNT_LINES.added };
  // The rank line only when the rescore went public (a held one waits for the owner's review).
  const [h] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${builderId}`;
  const rank = h?.held ? null : nowRank(await standingOf(builderId));
  return { show_to_builder: COUNT_LINES.done(n, name, rank) };
}

const CHAINS: readonly Chain[] = ['base', 'arc', 'monad', 'tempo'];
const chainOf = (ref: string): Chain | null => {
  const c = ref.split(':')[0]?.toLowerCase() as Chain;
  return CHAINS.includes(c) ? c : null;
};

async function tagFuture(builderId: number, key: string, now: Date, deps: YesDeps, reader: ReaderDeps): Promise<YesReply> {
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

/** The open program a tip jar can be built for now (freshPick over programs with the arc-tipjar starter). */
async function payment(now: Date, fresh: YesDeps['fresh'] = {}): Promise<YesReply> {
  const cards = (await listPrograms()).filter((c) => c.fresh_build?.starter === 'arc-tipjar');
  const pick = freshPick(cards, now, {
    hidden: new Set(),
    entered: new Set(),
    deployOn: fresh.deployOn ?? ((c) => deployChainOn(c) && rpcFor(c) !== null),
    hostOn: fresh.hostOn ?? r2Enabled(),
    ...(fresh.starters && { starters: fresh.starters }),
  });
  if (!pick) return { show_to_builder: COUNT_LINES.cantTips };
  return { show_to_builder: COUNT_LINES.tips, prepare: { program_id: pick.card.id, starter: pick.starter.id }, agent_note: TIPS_NOTE };
}

/**
 * The step a yes or no answers: the server's current one (the agent's kind is never trusted, T8
 * ruling). Null when there is none, or when the agent named another of the person's projects (the
 * builder answered an older line; nothing is done for a step they were not asked about).
 */
export async function stepFor(builderId: number, projectKey: string | null | undefined): Promise<MoveUp | null> {
  const step = await currentStep(builderId);
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
  const step = await stepFor(builderId, projectKey);
  const key = step?.project_key ?? null;
  if (!step || key === null) return { show_to_builder: COUNT_LINES.noted };
  const [p] = await sql()<{ name: string; untracked_contract: string | null }[]>`
    SELECT name, untracked_contract FROM builder_projects WHERE builder_id = ${builderId} AND project_key = ${key}`;
  if (!p) return { show_to_builder: COUNT_LINES.noted };
  const reader = deps.reader ?? defaultReaderDeps(now, Date.now() + REFRESH_BUDGET_MS);
  switch (step.kind) {
    case 'count_past':
      return p.untracked_contract ? countPast(builderId, key, p.name, p.untracked_contract, now, reader) : { show_to_builder: COUNT_LINES.noted };
    case 'tag_future':
      return tagFuture(builderId, key, now, deps, reader);
    case 'payment':
      return payment(now, deps.fresh);
    default:
      return { show_to_builder: COUNT_LINES.noted };
  }
}

/**
 * A no: nothing changes; that step (the server's current one) is not offered again for 30 days
 * (builder_profiles.standing_seen.declined, stand-view.ts DECLINE_MS).
 */
export async function moveUpNo(builderId: number, now: Date, projectKey?: string | null): Promise<YesReply> {
  const step = await stepFor(builderId, projectKey);
  if (step && step.kind !== 'send_link' && step.kind !== 'build')
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${stepKey(step.kind, step.project_key)}::text, ${now.toISOString()}::text))
      WHERE builder_id = ${builderId}`;
  return { show_to_builder: COUNT_LINES.noted };
}
