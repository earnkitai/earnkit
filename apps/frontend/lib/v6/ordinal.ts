/**
 * v3.8 E18 (plan item 13, section 9): the order inside a tier, for a program's reviewer. Each placed applicant gets
 * points from its verified evidence rows only (counted mainnet usage, commit activity, team, releases, tests and CI,
 * answered issues, package downloads of a package whose registry links back to the repo), and the reasons that carried
 * the most points in reviewer words. The tier still decides; the order only sorts inside it.
 *
 * Hidden below the floor (section 9's k>=10, "rank stays hidden until 10 verified builders"): with fewer than
 * ORDINAL_FLOOR applicants placed on read evidence (used, live or building), no applicant gets an ordinal at all.
 * Reviewer-facing only: never in a builder's reply (builderRules bans the word). Pure.
 */
import type { Row } from './evidence';
import type { Tier } from './tiers';

/** Applicants placed on read evidence a job needs before any ordinal is shown. */
export const ORDINAL_FLOOR = 10;
/** The tiers that rest on read evidence: the verified applicants the floor counts. */
export const VERIFIED_TIERS: readonly Tier[] = ['used', 'live', 'building'];
/** Reasons shown per applicant, the ones with the most points. */
const REASONS = 3;

export type Standing = { points: number; reasons: string[] };
export type Ordinal = { ordinal: number; of: number; reasons: string[] };

/** A signal: its row key (onchain rows by suffix, the best counted contract's), its weight, and its words. */
type Signal = { key: string; weight: number; words: (v: number) => string };
const n = (v: number) => v.toLocaleString('en-US');
const SIGNALS: Signal[] = [
  { key: 'onchain.funded_senders_90d', weight: 4, words: (v) => `${n(v)} senders the deployer did not fund in 90 days` },
  { key: 'onchain.tx_90d', weight: 1, words: (v) => `${n(v)} mainnet transactions in 90 days` },
  { key: 'packages.npm_downloads_30d', weight: 2, words: (v) => `${n(v)} npm downloads in 30 days` },
  { key: 'packages.pypi_downloads_30d', weight: 2, words: (v) => `${n(v)} PyPI downloads in 30 days` },
  { key: 'code.active_weeks_90d', weight: 3, words: (v) => `active ${n(v)} of 13 weeks` },
  { key: 'code.commits_60d', weight: 1, words: (v) => `${n(v)} commits in 60 days` },
  { key: 'team.contributors', weight: 1, words: (v) => `${n(v)} contributors` },
  { key: 'code.releases', weight: 1, words: (v) => `${n(v)} releases` },
  { key: 'code.issues_answered_90d', weight: 1, words: (v) => `${n(v)} issues answered in 90 days` },
];
const BOOLS: { key: string; points: number; words: string }[] = [
  { key: 'code.has_tests', points: 1, words: 'has tests' },
  { key: 'code.has_ci', points: 1, words: 'has CI' },
];

/** The best value of a key: an onchain key over counted mainnet contracts only. */
function valueOf(rows: Row[], key: string): number | null {
  if (key.startsWith('onchain.')) {
    const field = key.slice('onchain.'.length);
    const at = (i: string, k: string) => rows.find((r) => r.key === `onchain[${i}].${k}`)?.value;
    const idx = [...new Set(rows.map((r) => /^onchain\[(\d+)\]\./.exec(r.key)?.[1]).filter((x): x is string => !!x))];
    const vals = idx.filter((i) => at(i, 'counted') === true && at(i, 'mainnet') === true).map((i) => at(i, field)).filter((v): v is number => typeof v === 'number');
    return vals.length ? Math.max(...vals) : null;
  }
  const v = rows.find((r) => r.key === key)?.value;
  return typeof v === 'number' ? v : null;
}

/** Points and reasons from one applicant's evidence rows: log-scaled counts, so one huge number never decides. Pure. */
export function standing(rows: Row[]): Standing {
  const parts: { points: number; words: string }[] = [];
  for (const s of SIGNALS) {
    const v = valueOf(rows, s.key);
    if (v != null && v > 0) parts.push({ points: s.weight * Math.log2(1 + v), words: s.words(v) });
  }
  for (const b of BOOLS) if (rows.find((r) => r.key === b.key)?.value === true) parts.push({ points: b.points, words: b.words });
  const points = Math.round(parts.reduce((a, p) => a + p.points, 0) * 100) / 100;
  const reasons = [...parts].sort((a, b) => b.points - a.points).slice(0, REASONS).map((p) => p.words);
  return { points, reasons };
}

/**
 * The order inside each tier, by points (then ref, so it is stable), for every placed applicant; an empty map below
 * the floor. `of` is the tier's size. Pure.
 */
export function ordinals(items: { ref: string; tier: Tier | null; rows: Row[] }[]): Map<string, Ordinal> {
  const out = new Map<string, Ordinal>();
  if (items.filter((i) => i.tier !== null && VERIFIED_TIERS.includes(i.tier)).length < ORDINAL_FLOOR) return out;
  const byTier = new Map<Tier, { ref: string; s: Standing }[]>();
  for (const i of items) if (i.tier) byTier.set(i.tier, [...(byTier.get(i.tier) ?? []), { ref: i.ref, s: standing(i.rows) }]);
  for (const list of byTier.values()) {
    list.sort((a, b) => b.s.points - a.s.points || a.ref.localeCompare(b.ref));
    list.forEach((x, k) => out.set(x.ref, { ordinal: k + 1, of: list.length, reasons: x.s.reasons }));
  }
  return out;
}
