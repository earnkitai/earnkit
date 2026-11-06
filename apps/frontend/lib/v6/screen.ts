/**
 * The pilot run behind `pnpm screen <csv> --program <id>`: parses the list, reads each applicant in turn
 * (a repo resolved from the site when none is given), places it with the counts across the list, prints
 * a line per applicant and writes the markdown and CSV reports into one folder. Never writes elsewhere.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHAIN_REGISTRY, isKnownChain } from '../v5/chains';
import { CsvError, identicalPitches, parseApplicants, resolveRepo, sharedContributors, type Applicant } from './applicants';
import { type Evidence, type EvidenceDeps, readEvidence } from './evidence';
import { safeProbePage } from '../v5/safe-fetch';
import { readLive } from './live';
import { csvReport, markdownReport, ORDER, type ScreenRow } from './screen-report';
import { reviewerLine } from './tier-words';
import { DEFAULT_THRESHOLDS, place, type Thresholds } from './tiers';

export type RunDeps = {
  now: Date;
  log: (line: string) => void;
  /** The readers (default: the real ones). */
  evidence?: Omit<EvidenceDeps, 'now' | 'cache'>;
  env?: Record<string, string | undefined>;
};
export type RunResult = { code: number; rows: ScreenRow[]; reads: Evidence['reads']; files: string[] };

const USAGE = 'Usage: pnpm screen <csv> --program <id> [--chain base] [--out <dir>] [--no-cache] [--thresholds <json>]';
const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const REPO_PROBLEMS = /^repo link /;

type Args = { csv: string; program: string; chain: string; out: string | null; cache: boolean; thresholds: Thresholds };

/** The arguments, or the plain message saying what is wrong. Pure. */
function parseArgs(argv: string[]): Args | string {
  const a: Partial<Args> & { cache: boolean; chain: string } = { cache: true, chain: 'base' };
  let thresholds = '';
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => argv[++i] ?? '';
    if (v === '--program') a.program = next();
    else if (v === '--chain') a.chain = next().toLowerCase();
    else if (v === '--out') a.out = next();
    else if (v === '--no-cache') a.cache = false;
    else if (v === '--thresholds') thresholds = next();
    else if (v.startsWith('--') || a.csv) return USAGE;
    else a.csv = v;
  }
  if (!a.csv || !a.program) return USAGE;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(a.program)) return `Program id ${a.program} is not usable in a file name: letters, digits, dots, dashes.`;
  if (!isKnownChain(a.chain)) return `Unknown chain ${a.chain}. Known: ${Object.keys(CHAIN_REGISTRY).join(', ')}.`;
  const t: Thresholds = { ...DEFAULT_THRESHOLDS };
  if (thresholds) {
    let given: unknown;
    try {
      given = JSON.parse(thresholds);
    } catch {
      return 'The thresholds are not JSON, for example {"used_funded_senders":10}.';
    }
    if (typeof given !== 'object' || given === null || Array.isArray(given)) return 'The thresholds must be a JSON object.';
    for (const [k, v] of Object.entries(given)) {
      if (!Object.hasOwn(DEFAULT_THRESHOLDS, k)) return `Unknown threshold ${k}. Known: ${Object.keys(DEFAULT_THRESHOLDS).join(', ')}.`;
      if (typeof v !== 'number' || !Number.isFinite(v)) return `Threshold ${k} must be a number.`;
      t[k as keyof Thresholds] = v;
    }
  }
  return { csv: a.csv, program: a.program, chain: a.chain, out: a.out ?? null, cache: a.cache, thresholds: t };
}

const label = (a: Applicant) => `${a.ref} ${a.name}`;

/** Runs one screen. Returns code 1 with a plain message for bad arguments or a CSV that cannot be read at all. */
export async function run(argv: string[], d: RunDeps): Promise<RunResult> {
  const env = d.env ?? process.env;
  const reads = { github: 0, explorer: 0, site: 0 };
  const fail = (msg: string): RunResult => (d.log(msg), { code: 1, rows: [], reads, files: [] });
  const args = parseArgs(argv);
  if (typeof args === 'string') return fail(args);
  const out = args.out ?? join(env.EARNKIT_SCREEN_OUT || join(ROOT, '.screen-out'), 'screen');

  let text: string;
  try {
    text = readFileSync(args.csv, 'utf8');
  } catch {
    return fail(`Could not read the CSV at ${args.csv}.`);
  }
  let parsed: Applicant[];
  try {
    parsed = parseApplicants(text, { chain: args.chain });
  } catch (e) {
    if (e instanceof CsvError) return fail(`Could not parse the CSV: ${e.message}.`);
    throw e;
  }

  let cache = args.cache;
  if (cache && !env.DATABASE_URL) {
    cache = false;
    d.log('No DATABASE_URL: the cache is off for this run.');
  }
  d.log(`Screening ${parsed.length} applicants for ${args.program}. Files go to ${out}`);

  const pitches = identicalPitches(parsed);
  const logins = new Map<string, string[]>();
  const x = (ref: string) => ({ identical_pitch: pitches.get(ref) ?? 0, shared_contributors: sharedContributors(logins).get(ref) ?? 0 });
  const o = d.evidence ?? {};
  const read: { applicant: Applicant; evidence: Evidence | null }[] = [];
  const firstTier = new Map<string, string>();

  // One at a time: the GitHub budget and the explorer throttle are per process.
  for (const a0 of parsed) {
    const a: Applicant = { ...a0, problems: [...a0.problems] };
    let repo = a.repo_url;
    if (!repo && a.live_url) {
      // The page only, for its GitHub links: the domain's age is read once, with the evidence.
      const realProbe = o.probe ?? safeProbePage;
      const live = await readLive(a.live_url, {
        probe: (u, p) => (reads.site++, realProbe(u, p)),
        rdap: async () => ({ registered_at: null }),
        now: d.now,
      });
      repo = resolveRepo(a, live);
    }
    if (!repo && !a.problems.some((p) => REPO_PROBLEMS.test(p))) a.problems.push('no repo found');
    let evidence: Evidence | null = null;
    try {
      evidence = await readEvidence(
        { ...(repo && { repo_url: repo }), ...(a.live_url && { live_url: a.live_url }), contracts: a.contracts },
        { ...o, now: d.now, cache },
      );
      reads.github += evidence.reads.github;
      reads.explorer += evidence.reads.explorer;
      reads.site += evidence.reads.site;
    } catch {
      a.problems.push('the read failed, worth a retry');
    }
    logins.set(a.ref, evidence?.team?.logins ?? []);
    const tier = place(evidence, x(a.ref), args.thresholds, d.now).tier ?? 'no tier';
    firstTier.set(a.ref, tier);
    d.log(`${label(a)}: ${tier}`);
    read.push({ applicant: a, evidence });
  }

  // The counts across the list are final only now; a later applicant can change an earlier placement.
  const rows: ScreenRow[] = read.map(({ applicant, evidence }) => {
    const placement = place(evidence, x(applicant.ref), args.thresholds, d.now);
    return { applicant, evidence, placement, line: reviewerLine(placement, evidence) };
  });
  for (const r of rows) {
    const tier = r.placement.tier ?? 'no tier';
    if (firstTier.get(r.applicant.ref) !== tier) d.log(`${label(r.applicant)}: ${tier} (after the counts across the list)`);
  }

  const date = d.now.toISOString().slice(0, 10);
  const md = join(out, `${args.program}-${date}.md`);
  const csv = join(out, `${args.program}-${date}.csv`);
  try {
    mkdirSync(out, { recursive: true });
    writeFileSync(md, markdownReport(args.program, rows, d.now));
    writeFileSync(csv, csvReport(rows));
  } catch {
    return { ...fail(`Could not write to ${out}.`), rows, reads };
  }
  const count = (t: string) => rows.filter((r) => (r.placement.tier ?? 'no tier') === t).length;
  const totals = [...ORDER, 'no tier'].filter((t) => t !== 'no tier' || count(t)).map((t) => `${t} ${count(t)}`);
  d.log(`Totals: ${totals.join(', ')}`);
  d.log(`Reads used: GitHub ${reads.github}, explorer ${reads.explorer}, site ${reads.site}`);
  d.log(`Wrote ${md}`);
  d.log(`Wrote ${csv}`);
  return { code: 0, rows, reads, files: [md, csv] };
}
