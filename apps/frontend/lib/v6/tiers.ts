/**
 * Named tiers (design section 7): places one Evidence in used, live, building, unverified or flagged,
 * flags first, with the rows that decided it in reviewer words and what would move it up one tier in
 * builder words. Only real mainnet contracts count. Tier is null until something was read. Pure.
 */
import { chainName } from '../v5/chains';
import type { Evidence } from './evidence';
import type { OnchainRows } from './onchain';

export const TIERS = ['used', 'live', 'building', 'unverified', 'flagged'] as const;
export type Tier = (typeof TIERS)[number];
export type Thresholds = {
  used_funded_senders: number;
  push_within_days: number;
  flag_template_overlap: number;
  flag_own_share: number;
  flag_identical_pitch: number;
  flag_shared_contributors: number;
  flag_unfunded_ratio: number;
  flag_unfunded_min_senders: number;
};
export const DEFAULT_THRESHOLDS: Thresholds = {
  /** 25 wallets paying their own gas in 90 days is more than a team and its friends. */
  used_funded_senders: 25,
  /** Two months without a push is a project nobody is working on. */
  push_within_days: 60,
  /** Half the repo's files from one known starter: the starter is most of the work. */
  flag_template_overlap: 0.5,
  /** Under a fifth of a fork's work its own: someone else's project resubmitted. */
  flag_own_share: 0.2,
  /** Three others sending the same pitch is a copied application, not chance. */
  flag_identical_pitch: 3,
  /** Five other applicants sharing contributors is one team applying many times. */
  flag_shared_contributors: 5,
  /** Under a fifth of sampled senders funded on their own: farmed wallets, not users. */
  flag_unfunded_ratio: 0.2,
  /** Under 100 senders the ratio is too noisy to flag on. */
  flag_unfunded_min_senders: 100,
};
export type Flag = { rule: string; detail: string };
/** What stands between a placement and the tier above: the condition `next` names. */
export type Gap = 'funded_senders' | 'site' | 'push' | 'commits' | 'repo_or_site' | 'flag';
export type Placement = { tier: Tier | null; flags: Flag[]; because: string[]; next: string | null; gap: Gap | null };

const DAY = 86_400_000;
const n = (v: number) => v.toLocaleString('en-US');
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Rounded down: a share under a threshold never reads as the threshold. */
const pctDown = (v: number) => `${Math.floor(v * 100)}%`;
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const onMainnet = (c: OnchainRows) => `on ${chainName(c.chain)} mainnet`;
const pushedRow = (days: number) => (days <= 0 ? 'pushed today' : `pushed ${plural(days, 'day')} ago`);
const others = (v: number) => `${plural(v, 'other applicant')} ${v === 1 ? 'shares' : 'share'}`;
const most = <T>(xs: T[], by: (x: T) => number): T | undefined => xs.reduce<T | undefined>((a, x) => (a === undefined || by(x) > by(a) ? x : a), undefined);

function flagsOf(e: Evidence, counted: OnchainRows[], x: { identical_pitch: number; shared_contributors: number }, t: Thresholds) {
  const out: (Flag & { next: string })[] = [];
  const c = e.code;
  if (c?.template_overlap != null && c.template_overlap >= t.flag_template_overlap) {
    const starter = c.template_name ? `the ${c.template_name} starter` : 'a known starter';
    out.push({
      rule: 'template',
      detail: `${pct(c.template_overlap)} of files match ${starter}`,
      next: `Under ${pct(t.flag_template_overlap)} of files from a known starter; yours is ${pct(c.template_overlap)}.`,
    });
  }
  if (c?.fork_of && c.own_share != null && c.own_share < t.flag_own_share) {
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
      rule: 'unfunded',
      detail: `${n(farmed.funded_senders_90d!)} of ${n(farmed.funded_sample!)} sampled senders ${onMainnet(farmed)} paid their own gas (${n(farmed.senders_90d!)} senders in 90 days)`,
      next: `${pct(t.flag_unfunded_ratio)} of sampled wallets paying their own gas; ${n(farmed.funded_senders_90d!)} of ${n(farmed.funded_sample!)} do.`,
    });
  }
  return out;
}

/**
 * Places evidence in one tier, in design order: flagged, used, live, building, unverified. `x` holds the
 * counts across applicants (identical pitches, applicants sharing contributors). Pure.
 */
export function place(
  e: Evidence | null,
  x: { identical_pitch: number; shared_contributors: number },
  t: Thresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): Placement {
  if (!e) return { tier: null, flags: [], because: [], next: null, gap: null };
  const nothingRead = !e.code && !e.team && !e.depth && e.onchain.length === 0 && e.live.url_ok == null;
  if (e.partial && nothingRead) return { tier: null, flags: [], because: ['read was partial'], next: null, gap: null };

  const counted = e.onchain.filter((c) => c.is_contract === true && c.mainnet === true);
  const active = counted.filter((c) => (c.tx_90d ?? 0) > 0);
  const siteUp = e.live.url_ok === true;
  const pushMs = e.code?.last_push_at ? Date.parse(e.code.last_push_at) : NaN;
  const pushDays = Number.isFinite(pushMs) ? Math.floor((now.getTime() - pushMs) / DAY) : null;
  const pushedRecently = !e.code || (pushDays != null && pushDays <= t.push_within_days);
  const funded = counted.filter((c) => c.funded_senders_90d != null);
  // Usage is one contract's: rows carry counts, not addresses, so summing would count a wallet once per contract.
  const topFunded = most(funded, (c) => c.funded_senders_90d!);
  const topCount = topFunded?.funded_senders_90d ?? 0;
  const topActive = most(active, (c) => c.tx_90d!);

  const context: string[] = [];
  if (e.team?.contributors_90d != null) context.push(plural(e.team.contributors_90d, 'contributor'));
  const tail = (flagged: boolean) => [...context, ...(flagged ? [] : ['no flags']), ...(e.partial ? ['read was partial'] : [])];
  const pushRow = pushDays != null ? [pushedRow(pushDays)] : [];
  const fundedRow = [
    ...(topFunded ? [`${plural(topCount, 'funded sender')} ${onMainnet(topFunded)}`] : []),
    ...(counted.length > 1 ? [`${n(counted.length)} counted contracts`] : []),
  ];

  const flags = flagsOf(e, counted, x, t);
  if (flags.length) {
    return {
      tier: 'flagged',
      flags: flags.map(({ rule, detail }) => ({ rule, detail })),
      because: [...flags.map((f) => f.detail), ...tail(true)],
      next: flags[0].next,
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
      gap === 'funded_senders' ? `${n(t.used_funded_senders)} funded wallets on mainnet in 90 days; you have ${n(topCount)}.`
      : gap === 'site' ? 'A site that loads for your product.'
      : pushDays == null ? 'Push to the repo; EarnKit found no push date.'
      : `A push to the repo in the last ${plural(t.push_within_days, 'day')}; the last was ${plural(pushDays, 'day')} ago.`;
    return { tier: 'live', flags: [], because: [...rows, ...tail(false)], next, gap };
  }

  const c = e.code;
  const building = c && ((c.commits_90d ?? 0) > 0 || (c.commits_90d == null && pushDays != null && pushDays <= t.push_within_days));
  if (building) {
    const rows = [...(c.commits_90d ? [`${plural(c.commits_90d, 'commit')} in 90 days`] : []), ...pushRow];
    return { tier: 'building', flags: [], because: [...rows, ...tail(false)], next: 'A live product: a site that loads or a mainnet contract in use.', gap: 'site' };
  }

  const rows = [
    e.live.url_ok === false ? 'site does not load' : e.live.url ? 'site not read' : 'no site',
    topActive ? `${plural(topActive.tx_90d!, 'transaction')} in 90 days ${onMainnet(topActive)}`
      : counted.length ? 'no transactions in 90 days on mainnet' : 'no mainnet contract read',
    ...(c ? ['no commits in 90 days', ...pushRow] : ['no public repo']),
  ];
  const next = c ? 'Recent commits in your public repo or a live product EarnKit can read.' : 'A public repo or a live product EarnKit can read.';
  return { tier: 'unverified', flags: [], because: [...rows, ...tail(false)], next, gap: c ? 'commits' : 'repo_or_site' };
}
