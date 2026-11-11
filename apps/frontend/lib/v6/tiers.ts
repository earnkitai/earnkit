/**
 * Named tiers (design section 7): places one Evidence in used, live, building, unverified or flagged,
 * flags first, with the rows that decided it in reviewer words and what would move it up one tier in
 * builder words. Only counted mainnet contracts count (plausibly the builder's; the rest are shown with
 * their reason). Tier is null until something was read. Pure.
 */
import { chainName } from '../v5/chains';
import { isStarterRepo } from './code';
import { CONTRIBUTOR_PAGES } from './team';
import type { Evidence } from './evidence';
import type { OnchainRows } from './onchain';

export const TIERS = ['used', 'live', 'building', 'unverified', 'flagged'] as const;
export type Tier = (typeof TIERS)[number];
export type Thresholds = {
  used_funded_senders: number;
  push_within_days: number;
  flag_template_max_own_files: number;
  flag_own_share: number;
  flag_fork_min_commits: number;
  flag_identical_pitch: number;
  flag_shared_contributors: number;
  flag_unfunded_ratio: number;
  flag_unfunded_min_senders: number;
};
export const DEFAULT_THRESHOLDS: Thresholds = {
  /** 25 wallets the deployer did not fund in 90 days is more than a team and its friends. */
  used_funded_senders: 25,
  /** Two months without a push is a project nobody is working on. */
  push_within_days: 60,
  /** Under 10 files beyond a matched starter: the starter is the project. A large share alone is a starter built on. */
  flag_template_max_own_files: 10,
  /** Under a fifth of a fork's work its own: someone else's project resubmitted (forks of non-starters). */
  flag_own_share: 0.2,
  /** Under 20 commits after forking a known starter: the starter, not a project. Starters are forked to build on. */
  flag_fork_min_commits: 20,
  /** Three others sending the same pitch is a copied application, not chance. */
  flag_identical_pitch: 3,
  /** Five other applicants sharing contributors is one team applying many times. */
  flag_shared_contributors: 5,
  /** Under a fifth of sampled senders wallets the deployer did not fund: farmed wallets, not users. */
  flag_unfunded_ratio: 0.2,
  /** Under 100 senders the ratio is too noisy to flag on. */
  flag_unfunded_min_senders: 100,
};
/** L15-10 (v6.1.14): the thresholds that are shares, from 0 to 1; every other one is a count (or days), 0 and up. */
export const RATIO_THRESHOLDS = ['flag_own_share', 'flag_unfunded_ratio'] as const;
export type Flag = { rule: string; detail: string };
/** What stands between a placement and the tier above: the condition `next` names. */
export type Gap = 'funded_senders' | 'site' | 'push' | 'commits' | 'repo_or_site' | 'flag';
/**
 * `on_users` (M1, v6.1.14 fix round 1): building on verified onchain users alone, with no recent commit.
 * `next` is the exact rule (agent and owner words); `builder_next` (#6, v6.1.15) is the builder's form of it, null
 * when `next` is null. It differs only where `next` names deployer, senders or mainnet (the live usage gap, the
 * building gap and the self-funded users flag; Review Focus 5); every other gap's equals `next`.
 */
export type Placement = { tier: Tier | null; flags: Flag[]; because: string[]; next: string | null; builder_next: string | null; gap: Gap | null; on_users?: true };
/** The counts across applicants; `xp`: the program's own earlier screens in 90 days (shown, never a flag; L15-11). */
export type Counts = {
  identical_pitch: number;
  shared_contributors: number;
  xp?: { applications_90d: number; outcomes: { won: number; rejected: number } };
};

const DAY = 86_400_000;
const n = (v: number) => v.toLocaleString('en-US');
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Rounded down: a share under a threshold never reads as the threshold. */
const pctDown = (v: number) => `${Math.floor(v * 100)}%`;
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const onMainnet = (c: OnchainRows) => `on ${chainName(c.chain)} mainnet`;
const pushedRow = (days: number) => (days <= 0 ? 'pushed today' : `pushed ${plural(days, 'day')} ago`);
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);
/** Contracts shown at most, by address, as not counted. */
const NOT_COUNTED_SHOWN = 3;
/** L15-8 (v6.1.14): a page that says it is no product yet, in reviewer words. */
const PLACEHOLDER_WORDS: Record<string, string> = { 'for sale': 'site is for sale', parked: 'site is parked', 'coming soon': 'site says coming soon' };
/**
 * L15-5 (v6.1.14): why there is no repo block, in reviewer words, from the read's notes: a private repo, one private or
 * missing, a repo on another code host, an account link; else no repo was given (or it could not be read). Pure.
 */
function noRepoWords(e: Evidence): string {
  const notes = e.notes;
  if (notes.includes('not read: private repo')) return 'private repo';
  if (notes.includes('not read: private or missing')) return 'repo private or missing';
  const host = notes.find((x) => x.startsWith('repo not read: on '));
  if (host) return `${host.slice('repo not read: on '.length)} repo, not read`;
  if (notes.includes('repo link is an account, not a repo')) return 'account link, not a repo';
  if (notes.includes('repo not on github')) return 'repo link not on a code host';
  if (e.repo) return 'repo not read';
  return 'no public repo';
}
const others = (v: number) => `${plural(v, 'other applicant')} ${v === 1 ? 'shares' : 'share'}`;
const most = <T>(xs: T[], by: (x: T) => number): T | undefined => xs.reduce<T | undefined>((a, x) => (a === undefined || by(x) > by(a) ? x : a), undefined);

function flagsOf(e: Evidence, counted: OnchainRows[], x: Counts, t: Thresholds) {
  const out: (Flag & { next: string; builder_next?: string })[] = [];
  const c = e.code;
  if (c?.template_name && c.template_overlap != null && c.files_own != null && c.files_own < t.flag_template_max_own_files) {
    out.push({
      rule: 'template',
      detail: `${pct(c.template_overlap)} of files match the ${c.template_name} starter, ${plural(c.files_own, 'file')} beyond it`,
      next: `At least ${plural(t.flag_template_max_own_files, 'file')} of your own beyond the starter; yours has ${n(c.files_own)}.`,
    });
  }
  if (c?.fork_of && isStarterRepo(c.fork_of)) {
    // A starter is forked to build on: judged by the commits after the fork, not their share of its history.
    if (c.commits_own != null && c.commits_own < t.flag_fork_min_commits) {
      out.push({
        rule: 'fork',
        detail: `fork of the ${c.fork_of} starter with ${plural(c.commits_own, 'commit')} after the fork`,
        next: `At least ${plural(t.flag_fork_min_commits, 'commit')} of your own after the fork; yours has ${n(c.commits_own)}.`,
      });
    }
  } else if (c?.fork_of && c.own_share != null && c.own_share < t.flag_own_share) {
    out.push({
      rule: 'fork',
      detail: `fork of ${c.fork_of} with ${pctDown(c.own_share)} own work`,
      next: `At least ${pct(t.flag_own_share)} of the work your own; yours is ${pctDown(c.own_share)}.`,
    });
  }
  if (x.identical_pitch >= t.flag_identical_pitch) {
    out.push({
      rule: 'identical_pitch',
      detail: `${plural(x.identical_pitch, 'other applicant')} sent the same pitch`,
      next: `A pitch in your own words; ${plural(x.identical_pitch, 'other applicant')} sent the same text.`,
    });
  }
  if (x.shared_contributors >= t.flag_shared_contributors) {
    out.push({
      rule: 'shared_contributors',
      detail: `${others(x.shared_contributors)} contributors`,
      next: `A team of your own; ${others(x.shared_contributors)} contributors with you.`,
    });
  }
  const farmed = counted.find(
    (k) =>
      k.senders_90d != null && k.senders_90d >= t.flag_unfunded_min_senders && k.funded_sample != null && k.funded_sample > 0 &&
      k.funded_senders_90d != null && k.funded_senders_90d < t.flag_unfunded_ratio * k.funded_sample,
  );
  if (farmed) {
    out.push({
      // #15 (v6.1.15): was 'unfunded'; rows stored before read the same (tier-words RULE_WORDS).
      rule: 'self_funded_users',
      detail: `${n(farmed.funded_senders_90d!)} of ${n(farmed.funded_sample!)} sampled senders ${onMainnet(farmed)} are wallets the deployer did not fund (${n(farmed.senders_90d!)} senders in 90 days)`,
      next: `At least ${pct(t.flag_unfunded_ratio)} of sampled wallets not funded by the deployer; ${n(farmed.funded_senders_90d!)} of ${n(farmed.funded_sample!)} are.`,
      // Review Focus 5 (v6.1.15): the builder's form names no deployer, senders or mainnet.
      builder_next: `At least ${pct(t.flag_unfunded_ratio)} of sampled users from outside the team; I count ${n(farmed.funded_senders_90d!)} of ${n(farmed.funded_sample!)}.`,
    });
  }
  return out;
}

/**
 * Places evidence in one tier, in design order: flagged, used, live, building, unverified. `x` holds the
 * counts across applicants (identical pitches, applicants sharing contributors, other programs' screens). Pure.
 */
export function place(
  e: Evidence | null,
  x: Counts,
  t: Thresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): Placement {
  const p = placed(e, x, t, now);
  return { ...p, builder_next: p.builder_next ?? p.next };
}

type Placed = Omit<Placement, 'builder_next'> & { builder_next?: string };

function placed(e: Evidence | null, x: Counts, t: Thresholds, now: Date): Placed {
  if (!e) return { tier: null, flags: [], because: [], next: null, gap: null };
  const nothingRead = !e.code && !e.team && !e.depth && e.onchain.length === 0 && e.live.url_ok == null;
  if (e.partial && nothingRead) return { tier: null, flags: [], because: ['read was partial'], next: null, gap: null };

  const real = e.onchain.filter((c) => c.is_contract === true && c.mainnet === true);
  const counted = real.filter((c) => c.counted === true);
  const notCounted = real.filter((c) => c.counted !== true);
  const active = counted.filter((c) => (c.tx_90d ?? 0) > 0);
  // L15-8 (v6.1.14): a page saying it is for sale, parked or coming soon loads, but is no product.
  const placeholder = e.live.url_ok === true && e.live.placeholder ? e.live.placeholder : null;
  const siteUp = e.live.url_ok === true && !placeholder;
  const pushMs = e.code?.last_push_at ? Date.parse(e.code.last_push_at) : NaN;
  const pushDays = Number.isFinite(pushMs) ? Math.floor((now.getTime() - pushMs) / DAY) : null;
  // No code block passes: a repo-less project, and also a repo whose read failed (the note says so; no push date to hold against it).
  const pushedRecently = !e.code || (pushDays != null && pushDays <= t.push_within_days);
  const funded = counted.filter((c) => c.funded_senders_90d != null);
  // Usage is one contract's: rows carry counts, not addresses, so summing would count a wallet once per contract.
  const topFunded = most(funded, (c) => c.funded_senders_90d!);
  const topCount = topFunded?.funded_senders_90d ?? 0;
  const topActive = most(active, (c) => c.tx_90d!);

  const context: string[] = [];
  // L15-19 (v6.1.14): everyone who committed (a row cached before reads the window's count); never 0 shown.
  const people = e.team ? e.team.contributors ?? e.team.contributors_90d : null;
  if (people != null && people > 0) context.push(e.team?.contributors_more ? `${n(CONTRIBUTOR_PAGES * 100)}+ contributors` : plural(people, 'contributor'));
  if (x.xp && x.xp.applications_90d > 0) context.push(`seen in ${plural(x.xp.applications_90d, 'earlier screen')} of this program in 90 days`);
  // L15-23 (v6.1.14): a contract on a chain EarnKit has no reader for is named, never silently left out.
  const unread = e.onchain.filter((c) => c.mainnet == null && /^not read: no explorer for /.test(c.note ?? ''));
  const skipped = [
    ...notCounted.slice(0, NOT_COUNTED_SHOWN).map((k) => `${short(k.address)} on ${chainName(k.chain)}: ${k.counted_reason ?? 'not counted'}`),
    ...(notCounted.length > NOT_COUNTED_SHOWN ? [`${plural(notCounted.length - NOT_COUNTED_SHOWN, 'more contract')} not counted`] : []),
    ...unread.slice(0, NOT_COUNTED_SHOWN).map((k) => `${short(k.address)} on ${chainName(k.chain)}: not read`),
    ...(unread.length > NOT_COUNTED_SHOWN ? [`${plural(unread.length - NOT_COUNTED_SHOWN, 'more contract')} not read`] : []),
  ];
  const tail = (flagged: boolean) => [...skipped, ...context, ...(flagged ? [] : ['no flags']), ...(e.partial ? ['read was partial'] : [])];
  const pushRow = pushDays != null ? [pushedRow(pushDays)] : [];
  const fundedRow = [
    // L15-6 (v6.1.14): the count is of sampled senders the deployer did NOT fund, and the row says so.
    ...(topFunded ? [`${plural(topCount, 'sender')} the deployer did not fund ${onMainnet(topFunded)}`] : []),
    ...(counted.length > 1 ? [`${n(counted.length)} counted contracts`] : []),
  ];

  const flags = flagsOf(e, counted, x, t);
  if (flags.length) {
    return {
      tier: 'flagged',
      flags: flags.map(({ rule, detail }) => ({ rule, detail })),
      because: [...flags.map((f) => f.detail), ...tail(true)],
      next: flags[0].next,
      ...(flags[0].builder_next && { builder_next: flags[0].builder_next }),
      gap: 'flag',
    };
  }

  const usedBy = topFunded !== undefined && topCount >= t.used_funded_senders;
  if (siteUp && usedBy && pushedRecently) {
    return { tier: 'used', flags: [], because: [...fundedRow, 'site loads', ...pushRow, ...tail(false)], next: null, gap: null };
  }

  const liveByContract = topActive !== undefined && pushedRecently;
  if (siteUp || liveByContract) {
    const rows = [
      ...(siteUp ? ['site loads'] : []),
      ...(topActive ? [`${plural(topActive.tx_90d!, 'transaction')} in 90 days ${onMainnet(topActive)}`] : []),
      ...fundedRow,
      ...pushRow,
    ];
    const gap: Gap = !usedBy ? 'funded_senders' : !siteUp ? 'site' : 'push';
    const next =
      gap === 'funded_senders' ? `${n(t.used_funded_senders)} senders the deployer did not fund, on mainnet in 90 days; you have ${n(topCount)}.`
      : gap === 'site' ? 'A site that loads for your product.'
      : pushDays == null ? 'Push to the repo; EarnKit found no push date.'
      : `A push to the repo in the last ${plural(t.push_within_days, 'day')}; the last was ${plural(pushDays, 'day')} ago.`;
    // #6 (v6.1.15): the builder reads the usage gap in plain words; agents and owners keep the exact rule in `next`.
    const builder_next = gap === 'funded_senders' ? `about ${n(t.used_funded_senders)} outside users in 90 days; I count ${n(topCount)}.` : undefined;
    return { tier: 'live', flags: [], because: [...rows, ...tail(false)], next, ...(builder_next && { builder_next }), gap };
  }

  const c = e.code;
  // Building is commits in the last 60 days; the window read is 90, so the count is the dates inside 60. L15-7
  // (v6.1.14): an empty repo is never building (its push date is its creation), and verified onchain users (senders
  // the deployer did not fund, on a counted mainnet contract) are at least building, however old the repo.
  const empty = c?.empty === true;
  const building = c && !empty && ((c.commits_60d ?? 0) > 0 || (c.commits_60d == null && pushDays != null && pushDays <= t.push_within_days));
  if (building) {
    const rows = [...(c.commits_60d ? [`${plural(c.commits_60d, 'commit')} in 60 days`] : []), ...pushRow];
    // Review Focus 5 (v6.1.15): the builder's form drops "mainnet"; the agent's keeps the exact rule.
    return {
      tier: 'building', flags: [], because: [...rows, ...tail(false)], next: 'A live product: a site that loads or a mainnet contract in use.',
      builder_next: 'A live product: a site that loads or a contract in use.', gap: 'site',
    };
  }
  if (topCount > 0) {
    const rows = [...(topActive ? [`${plural(topActive.tx_90d!, 'transaction')} in 90 days ${onMainnet(topActive)}`] : []), ...fundedRow, ...pushRow];
    const next = pushDays == null ? 'A site that loads for your product.' : `A push to the repo in the last ${plural(t.push_within_days, 'day')}; the last was ${plural(pushDays, 'day')} ago.`;
    return { tier: 'building', flags: [], because: [...rows, ...tail(false)], next, gap: pushDays == null ? 'site' : 'push', on_users: true };
  }

  const rows = [
    placeholder ? PLACEHOLDER_WORDS[placeholder] ?? 'site is a placeholder' : e.live.url_ok === false ? 'site does not load' : e.live.url ? 'site not read' : 'no site',
    topActive ? `${plural(topActive.tx_90d!, 'transaction')} in 90 days ${onMainnet(topActive)}`
      : counted.length ? 'no transactions in 90 days on mainnet' : notCounted.length ? 'no counted mainnet contract' : 'no mainnet contract read',
    ...(empty ? ['empty repo'] : c ? ['no commits in 60 days', ...pushRow] : [noRepoWords(e)]),
  ];
  const next = empty ? 'Code pushed to your public repo, or a live product EarnKit can read.' : c ? 'Recent commits in your public repo or a live product EarnKit can read.' : 'A public repo or a live product EarnKit can read.';
  return { tier: 'unverified', flags: [], because: [...rows, ...tail(false)], next, gap: c ? 'commits' : 'repo_or_site' };
}
