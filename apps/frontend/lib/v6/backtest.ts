/**
 * v3.8 E17 (plan item 12, section 18): the backtest (scripts/backtest.mts). Scores a past round from public data with
 * the screen's method as frozen in METHOD_VERSION: each entry's evidence is cut off at the round's deadline (`until`),
 * placed in a tier as the screen would have on that day, and called a hit when the method's pick agrees with the
 * outcome (picked and won, or not picked and did not win), else a miss. Misses are printed with hits.
 *
 * The printed report is the public-safe form: an entry that is not an EarnKit user gets hit or miss and nothing else,
 * never a tier, flag or reason. Tiers, flags, reasons and the evidence go only to the private dataset (the backtest_*
 * tables, with --apply). Blocks with no history (site, tree, releases, issues, contributors, contract source) are read
 * as they are today and named as possibly leaked. Dry run unless --apply.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { type Db, sql } from '../v5/db';
import { sharedContributors } from './applicants';
import { type Evidence, type EvidenceDeps, readEvidence } from './evidence';
import { DEFAULT_THRESHOLDS, place, type Placement, type Tier } from './tiers';

/**
 * The method as scored: bump it whenever placement, thresholds or the readers change what a tier means. A stored score
 * is never rewritten under the same version, so a changed method scored under an old version would mix two methods.
 */
export const METHOD_VERSION = 'screen-v1-2026-11-24';
/** The tiers the method puts near the top: its picks. */
export const PICKED: readonly Tier[] = ['used', 'live', 'building'];

const Contract = z.object({ chain: z.string().min(1), address: z.string().min(1) });
const Entry = z.object({
  ref: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  repo_url: z.string().url().optional(),
  live_url: z.string().url().optional(),
  contracts: z.array(Contract).max(10).optional(),
  /** On the program's public winner list for this round. */
  won: z.boolean(),
  /** Set only for an EarnKit user (their builders id): the only entries whose tier may be printed. */
  builder_id: z.number().int().positive().optional(),
  /** Where the entry and its outcome were found (a gallery or announcement). */
  source_url: z.string().url().optional(),
});
export const RoundFile = z.object({
  program_id: z.string().min(1).max(64),
  round: z.string().min(1).max(64),
  /** The evidence cutoff: the round's submission deadline, an ISO instant with its zone. */
  until: z.string().datetime({ offset: true }),
  source_url: z.string().url().optional(),
  entries: z.array(Entry).min(1).max(500),
}).superRefine((r, ctx) => {
  const refs = r.entries.map((e) => e.ref);
  if (new Set(refs).size !== refs.length) ctx.addIssue({ code: 'custom', message: 'entry refs must be unique' });
});
export type RoundFile = z.infer<typeof RoundFile>;
export type RoundEntry = z.infer<typeof Entry>;

export type Verdict = 'hit' | 'miss';
export type Scored = { entry: RoundEntry; evidence: Evidence | null; placement: Placement; verdict: Verdict; leaked: string[] };

/** Hit when the method's pick agrees with the outcome. An entry with nothing read is not picked. Pure. */
export function verdictOf(tier: Tier | null, won: boolean): Verdict {
  return (tier !== null && PICKED.includes(tier)) === won ? 'hit' : 'miss';
}

/**
 * Scores every entry on evidence cut at the round's deadline, the placement as of that day, with the counts across
 * the round (shared contributors; galleries carry no pitch). One at a time, as the screen reads.
 */
export async function scoreRound(round: RoundFile, deps: Omit<EvidenceDeps, 'now' | 'until' | 'cache'> = {}): Promise<Scored[]> {
  const until = new Date(round.until);
  const read: { entry: RoundEntry; evidence: Evidence | null }[] = [];
  for (const entry of round.entries) {
    let evidence: Evidence | null = null;
    try {
      evidence = await readEvidence(
        { ...(entry.repo_url && { repo_url: entry.repo_url }), ...(entry.live_url && { live_url: entry.live_url }), contracts: entry.contracts ?? [] },
        { ...deps, now: until, until, cache: false },
      );
    } catch {
      // Nothing read: no tier, so not picked; the report counts it as could not be read.
    }
    read.push({ entry, evidence });
  }
  const shared = sharedContributors(new Map(read.map((r) => [r.entry.ref, r.evidence?.team?.logins ?? []])));
  return read.map(({ entry, evidence }) => {
    const placement = place(evidence, { identical_pitch: 0, shared_contributors: shared.get(entry.ref) ?? 0 }, DEFAULT_THRESHOLDS, until);
    return { entry, evidence, placement, verdict: verdictOf(placement.tier, entry.won), leaked: evidence?.leaked ?? [] };
  });
}

/**
 * The public-safe report: totals, then one line per entry. A non-user's line is its name, whether it won, and hit or
 * miss; only an EarnKit user's line carries its tier. No reasons, flags or order of merit for anyone. Pure.
 */
export function reportLines(round: RoundFile, scored: Scored[]): string[] {
  const winners = scored.filter((s) => s.entry.won);
  const picks = scored.filter((s) => s.placement.tier !== null && PICKED.includes(s.placement.tier));
  const leaked = scored.filter((s) => s.leaked.length > 0).length;
  const lines = [
    `Backtest of ${round.program_id} ${round.round}, method ${METHOD_VERSION}, evidence cut at ${round.until}.`,
    `Winners the method picked: ${winners.filter((s) => s.verdict === 'hit').length} of ${winners.length}. Picks that won: ${picks.filter((s) => s.entry.won).length} of ${picks.length}.`,
    `Hits ${scored.filter((s) => s.verdict === 'hit').length}, misses ${scored.filter((s) => s.verdict === 'miss').length}. ${leaked} of ${scored.length} entries read some blocks as they are today (possibly leaked). ${scored.filter((s) => !s.evidence).length} could not be read.`,
  ];
  for (const s of scored) {
    const tier = s.entry.builder_id !== undefined ? `, ${s.placement.tier ?? 'no tier'}` : '';
    lines.push(`${s.entry.ref} ${s.entry.name}: ${s.verdict}${s.entry.won ? ', won' : ''}${tier}`);
  }
  return lines;
}

/**
 * Writes the round, its entries and one score per entry under METHOD_VERSION. A round already stored with another
 * cutoff is refused; an entry's score already stored under this version is kept, never rewritten. Returns the scores
 * written and kept.
 */
export async function storeRound(tx: Db, round: RoundFile, scored: Scored[], now: Date): Promise<{ written: number; kept: number }> {
  const [r] = await tx<{ id: string; until: Date }[]>`
    INSERT INTO backtest_rounds (program_id, round, until, source_url) VALUES (${round.program_id}, ${round.round}, ${new Date(round.until)}, ${round.source_url ?? null})
    ON CONFLICT (program_id, round) DO UPDATE SET source_url = COALESCE(EXCLUDED.source_url, backtest_rounds.source_url)
    RETURNING id, until`;
  if (r.until.getTime() !== new Date(round.until).getTime()) throw new Error(`${round.program_id} ${round.round} is stored with cutoff ${r.until.toISOString()}: nothing written`);
  let written = 0;
  for (const s of scored) {
    const e = s.entry;
    const subject = { repo_url: e.repo_url ?? null, live_url: e.live_url ?? null, contracts: e.contracts ?? [] };
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO backtest_entries (round_id, ref, name, subject, won, builder_id, source_url)
      VALUES (${r.id}, ${e.ref}, ${e.name}, ${tx.json(subject)}, ${e.won}, ${e.builder_id ?? null}, ${e.source_url ?? null})
      ON CONFLICT (round_id, ref) DO UPDATE SET name = EXCLUDED.name, subject = EXCLUDED.subject, won = EXCLUDED.won,
        builder_id = EXCLUDED.builder_id, source_url = EXCLUDED.source_url
      RETURNING id`;
    const p = s.placement;
    const ins = await tx`
      INSERT INTO backtest_scores (entry_id, method_version, tier, flags, because, verdict, leaked, evidence, scored_at)
      VALUES (${row.id}, ${METHOD_VERSION}, ${p.tier}, ${tx.json(p.flags)}, ${tx.json(p.because)}, ${s.verdict}, ${s.leaked},
        ${s.evidence ? tx.json({ rows: s.evidence.rows, notes: s.evidence.notes, read_at: s.evidence.read_at } as never) : null}, ${now})
      ON CONFLICT (entry_id, method_version) DO NOTHING`;
    written += ins.count;
  }
  return { written, kept: scored.length - written };
}

/** `pnpm backtest --file <round.json> [--apply]`: scores the round, prints the public-safe report, and with --apply stores it. */
export async function main(
  argv: string[],
  out: (s: string) => void = console.log,
  deps: { evidence?: Omit<EvidenceDeps, 'now' | 'until' | 'cache'>; now?: Date } = {},
): Promise<{ scored: Scored[]; stored: { written: number; kept: number } | null }> {
  const i = argv.indexOf('--file');
  const path = i >= 0 ? argv[i + 1] : undefined;
  if (!path) throw new Error('--file takes the round JSON path');
  const apply = argv.includes('--apply');
  const round = RoundFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  const scored = await scoreRound(round, deps.evidence);
  reportLines(round, scored).forEach((l) => out(l));
  if (!apply) {
    out('Dry run: nothing stored. --apply writes the round, entries and scores.');
    return { scored, stored: null };
  }
  let stored!: { written: number; kept: number };
  await sql().begin(async (tx) => {
    stored = await storeRound(tx, round, scored, deps.now ?? new Date());
  });
  out(`Stored: ${stored.written} scores written, ${stored.kept} already stored under ${METHOD_VERSION} and kept.`);
  return { scored, stored };
}
