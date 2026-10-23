import { endsOf, prizeOf } from './entry-text';
import { CHAIN_NAMES, effortOf, type Verdict } from './match';
import type { PastRound } from './program-file';
import type { ProgramRow } from './programs';

/**
 * v2.7 §2: a program's guide (difficulty, what won before, what the ecosystem wants, the best bet,
 * the builder bonus). One renderer for get_program, the cards and the /programs/<id> page. Pure.
 */
export type Level = 'Easy' | 'Medium' | 'Hard';
/**
 * v2.8 Ruling 12 (plan): `rated` is true for an EarnKit rating, shown as just the level ("Easy"):
 * its `basis` is '' and no basis line, stat or label is ever shown for it.
 */
export type Difficulty = { level: Level; estimate: boolean; rated: boolean; basis: string };

/** Ruling 2 (plan): odds bands, lower bounds included (exactly 25% is Easy, exactly 8% Medium). */
export const ODDS_BANDS = { easy: 0.25, medium: 0.08 } as const;

export type GuideFacts = Pick<
  ProgramRow,
  | 'past_rounds'
  | 'focus'
  | 'best_bet'
  | 'difficulty_override'
  | 'winners_per_round'
  | 'tag'
  | 'each_time'
  | 'submission_requirements'
  | 'rules'
  | 'chains'
> & {
  /** v2.9 A4 (Pre-flight P30): an investment program is Hard at program level. Absent: not one. */
  investment?: boolean;
  /**
   * v2.9 A8 (match-loop.ts, Pre-flight P30): wins or places per entry from `likely` rows; a program
   * under 5% reads one step harder. Null or absent under 30 labelled entries (numeric: a string from SQL).
   */
  match_precision?: number | string | null;
};

/** v2.9 A4: the tag whose programs are at least Medium at program level, even with an EarnKit rating. */
export const NEEDS_LIVE_PRODUCT = 'needs a live product';

const VIDEO = /\b(video|loom)\b/i;
const MAINNET = /\bmainnet\b/i;

/**
 * Ruling C4: whether a round is this program's newest own round (the file states `own: true`, and
 * it is first). Only then does the guide say "last round" / "What won last time"; any other round
 * is named (Rulings C2, C3).
 */
const lastOwn = (p: Pick<GuideFacts, 'past_rounds'>, r: PastRound) => r === p.past_rounds[0] && r.own === true;

/** "last round" for the program's newest own round, else "in <label>". */
const when = (p: GuideFacts, r: PastRound) => (lastOwn(p, r) ? 'last round' : `in ${r.label}`);

/**
 * v2.7 §2, Rulings 2-5 (plan): the difficulty and the source_url its basis rests on (the
 * override's, the round's, or the program's own for `winners_per_round`, Ruling 6). One
 * selection for difficultyOf and guideSources, so the cited source always matches the basis. Pure.
 */
function difficultyFrom(p: GuideFacts & { source_url?: string }): { difficulty: Difficulty; source_url: string | null } {
  const from = difficultyBase(p);
  const d = from.difficulty;
  // v2.9 A4, Pre-flight P30: one program level for the landing, guides and rows. An investment is
  // Hard; a program that needs a live product is at least Medium, even with an EarnKit rating.
  const floored: Level = p.investment ? 'Hard' : p.tag === NEEDS_LIVE_PRODUCT ? maxLevel(d.level, 'Medium') : d.level;
  // v2.9 A8: under 5% of `likely` entries won: one step harder, from real outcomes (not an estimate).
  const low = p.match_precision != null && Number(p.match_precision) < LOW_PRECISION;
  const level = low ? harder(floored) : floored;
  if (level === d.level) return from;
  return low
    ? { ...from, difficulty: { ...d, level, estimate: false, basis: d.basis && `${d.basis}; under 5% of strong matches won` } }
    : { ...from, difficulty: { ...d, level } };
}

function difficultyBase(p: GuideFacts & { source_url?: string }): { difficulty: Difficulty; source_url: string | null } {
  const o = p.difficulty_override;
  // v2.8 Ruling 12 (plan): the EarnKit rating, just "Easy"; its source is the program page.
  if (o && 'rated_by' in o)
    return { difficulty: { level: 'Easy', estimate: false, rated: true, basis: '' }, source_url: o.source_url };
  // v2.8 Ruling 11 (plan): a stated override may be an estimate ("Hard (estimate)").
  if (o)
    return { difficulty: { level: o.level, estimate: o.estimate === true, rated: false, basis: o.basis }, source_url: o.source_url };
  const newest = p.past_rounds[0] ?? null;
  // Ruling 2 (plan): odds from the newest round with both counts.
  const counted = p.past_rounds.find((r) => r.submissions && r.winners);
  if (counted) {
    const odds = counted.winners! / counted.submissions!;
    const level: Level =
      odds >= ODDS_BANDS.easy ? 'Easy' : odds >= ODDS_BANDS.medium ? 'Medium' : 'Hard';
    return {
      difficulty: { level, estimate: false, rated: false, basis: `${counted.winners} of ~${counted.submissions} entries won ${when(p, counted)}` },
      source_url: counted.source_url,
    };
  }
  // Ruling 4 (plan): the estimate. Never Easy (Ruling 3): without counts, no promise of good odds.
  const winners = newest?.winners ?? p.winners_per_round ?? null;
  const answers = p.submission_requirements.filter((r) => r.required && r.from === 'builder').length;
  const barriers = [
    p.each_time.some((s) => VIDEO.test(s)),
    answers > 2 || p.each_time.length > 1,
    [...p.rules, ...p.submission_requirements.map((r) => `${r.label} ${r.description ?? ''}`)].some((s) =>
      MAINNET.test(s),
    ),
  ].filter(Boolean).length;
  let score = 0;
  if (winners !== null && winners >= 20) score += 1;
  if (winners !== null && winners <= 3) score -= 1;
  if (p.tag === 'long shot') score -= 2;
  if (barriers >= 2) score += 1;
  const level: Level = score < 0 ? 'Hard' : 'Medium';
  const est = (basis: string, source_url: string | null) => ({ difficulty: { level, estimate: true, rated: false, basis }, source_url });
  // "no past results yet" only with no past round at all (Ruling 4; review Finding 2).
  if (newest?.winners) return est(`${winners} winners ${when(p, newest)}; entry count not published`, newest.source_url);
  if (newest)
    return p.winners_per_round
      ? est(`${p.winners_per_round} winners per round; past counts not published`, p.source_url ?? null)
      : est('winners not published', null);
  return winners === null
    ? est('no past results yet', null)
    : est(`${winners} winners per round; no past results yet`, p.source_url ?? null);
}

/** v2.7 §2, Rulings 2-5 (plan): the program's difficulty from its own data. Pure. */
export const difficultyOf = (p: GuideFacts): Difficulty => difficultyFrom(p).difficulty;

const ORDER: Level[] = ['Easy', 'Medium', 'Hard'];
/** v2.9 A4: the harder of the levels. Pure. */
const maxLevel = (...ls: Level[]): Level => ORDER[Math.max(...ls.map((l) => ORDER.indexOf(l)))];
/** v2.9 A4: one step harder (Hard stays Hard). Pure. */
export const harder = (l: Level): Level => ORDER[Math.min(2, ORDER.indexOf(l) + 1)];
/** v2.9 A8: under this share of `likely` entries winning, a program reads one step harder. */
export const LOW_PRECISION = 0.05;
/** v2.9 A4: Easy first, for sorting by level. Pure. */
export const levelRank = (l: Level): number => ORDER.indexOf(l);

/**
 * v2.9 A4: what a row's difficulty reads from its program: `difficulty`, the program level
 * (difficultyOf: odds, the `needs a live product` floor, investment, match precision). Pre-flight
 * P30: those rules live in difficultyOf only, so the other fields are accepted but not read here.
 */
export type RowProgram = {
  difficulty: Difficulty;
  tag?: string | null;
  investment?: boolean;
  past_rounds?: PastRound[];
  match_precision?: number | null;
};

/**
 * v2.9 A4 (Pre-flight P30): a matched row's difficulty = max(program level, distance). The program
 * level is difficultyOf (odds, the `needs a live product` floor, investment, match precision under
 * 5%), never recomputed here. Distance: none or
 * minutes is Easy, hours or days Medium, weeks Hard. Pre-flight P2: distance comes from the missing
 * items other than `real_users`; `real_users` missing is then Hard while unverified, Medium after a
 * verified live link or a users claim, never Easy. `estimate` only while the program's level decides. Pure.
 */
export function rowDifficulty(
  p: RowProgram,
  v: Pick<Verdict, 'missing' | 'effort'>,
  o: { liveVerified: boolean; hasUsersClaim: boolean },
): { level: Level; estimate: boolean } {
  const prog = p.difficulty;
  const users = v.missing.includes('real_users');
  const effort = users ? effortOf(v.missing.filter((m) => m !== 'real_users')) : v.effort;
  const distance: Level = effort === 'weeks' ? 'Hard' : effort === 'hours' || effort === 'days' ? 'Medium' : 'Easy';
  let level = maxLevel(prog.level, distance);
  if (users) level = maxLevel(level, o.liveVerified || o.hasUsersClaim ? 'Medium' : 'Hard');
  return { level, estimate: prog.estimate && level === prog.level };
}

/** The Difficulty cell: "Medium", "Hard (estimate)". Pure. */
export const difficultyLabel = (d: Difficulty) => (d.estimate ? `${d.level} (estimate)` : d.level);

/** v2.8 Ruling 17 (plan): the basis as its own sentence: first letter capitalized, a closing period. Pure. */
export const difficultyBasis = (d: Difficulty) => {
  const b = d.basis.trim();
  const cap = b.charAt(0).toUpperCase() + b.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
};

/**
 * v2.8 Ruling 17 (plan): "Medium (estimate). 20 winners per round; past counts not published."
 * v2.8 Ruling 12 (plan): an EarnKit rating is the label alone ("Easy"). Pure.
 */
export const difficultyText = (d: Difficulty) => (d.rated ? difficultyLabel(d) : `${difficultyLabel(d)}. ${difficultyBasis(d)}`);

export type Guide = {
  /** "Arc Microgrants · 500 USDC × 20 grants · ends Oct 14" ("· not open yet" for an upcoming program). */
  header: string;
  /** v3 Stage 2: an upcoming program's one line under the header (program file opens_note), else null. */
  opens_note: string | null;
  difficulty: Difficulty;
  /**
   * Theme lines, then example lines, without "- ". `own`: the program's newest own round ("What
   * won last time"); otherwise a predecessor or older round ("What won before", Ruling C3).
   * `event` (Ruling C12): "in <label>" for any round that isn't the program's newest own round,
   * shown as a small line under the heading; null for the own round. It names the round shown
   * here, which may differ from the round the difficulty basis names.
   */
  won: { own: boolean; event: string | null; lines: string[]; source_url: string } | null;
  wants: { ecosystem: string; areas: string[]; source_url: string } | null;
  /**
   * v2.10 item 3 (Pre-flight P2): without past rounds or a focus, the program's first 2 rules, shown
   * only in replies (guideText) as "What it wants". The public guide page keeps reading `wants`.
   */
  rules_wants: string[] | null;
  best_bet: string | null;
};

/** The round "What won" uses: the newest with themes or examples. */
const wonRound = (p: Pick<GuideFacts, 'past_rounds'>) =>
  p.past_rounds.find((r) => r.themes?.length || r.examples?.length) ?? null;

/**
 * "What won" lines (Ruling 9 (plan)): the top 3 themes by count, then the examples. Final review
 * M3: when the source describes only some winners (`themes_of` below `winners`), the counts are
 * shown without a denominator, since they aren't "of" every winner. Pure.
 */
function wonLines(r: PastRound): string[] {
  const themes = [...(r.themes ?? [])].sort((a, b) => b.count - a.count).slice(0, 3);
  const of = r.winners && !(r.themes_of != null && r.themes_of < r.winners) ? r.winners : null;
  return [
    ...themes.map((t, i) => {
      const unit = i === 0 ? ' winners' : '';
      return `${t.theme} (${of ? `${t.count} of ${of}${unit}` : `${t.count}${unit}`})`;
    }),
    // Task 1 carry: "cited for" only when a judge or organizer said why.
    ...(r.examples ?? []).map((e) => `Example: ${e.name}, ${e.what}${e.why ? `; cited for ${e.why}` : ''}`),
  ];
}

/** v2.7 §2: the guide for one curated program. Pure. */
export function programGuide(
  p: GuideFacts & Pick<ProgramRow, 'title' | 'summary' | 'ends_at' | 'status' | 'opens_note'>,
  now = new Date(),
): Guide {
  const past = p.ends_at !== null && p.ends_at <= now;
  // v3 Stage 2: an upcoming program isn't open yet: "not open yet" and its note.
  const upcoming = p.status === 'upcoming' && !past;
  const closed = !upcoming && (p.status !== 'active' || past);
  const ends = endsOf(p);
  const end = upcoming ? 'not open yet' : closed ? 'closed' : ends === 'rolling' ? 'rolling' : `ends ${ends}`;
  const won = wonRound(p);
  return {
    header: `${p.title} · ${prizeOf(p)} · ${end}`,
    opens_note: upcoming ? (p.opens_note ?? null) : null,
    difficulty: difficultyOf(p),
    won: won
      ? { own: lastOwn(p, won), event: lastOwn(p, won) ? null : `in ${won.label}`, lines: wonLines(won), source_url: won.source_url }
      : null,
    wants: p.focus
      ? {
          ecosystem: p.focus.ecosystem ?? CHAIN_NAMES[p.chains[0]] ?? p.title,
          areas: p.focus.areas,
          source_url: p.focus.source_url,
        }
      : null,
    rules_wants: !p.focus && p.past_rounds.length === 0 && p.rules.length > 0 ? p.rules.slice(0, 2) : null,
    best_bet: p.best_bet ?? null,
  };
}

/**
 * Every source_url the guide's facts come from, deduped. `source_url` is the program's own, cited
 * when the basis rests on `winners_per_round` (Ruling 6). Pure.
 */
export function guideSources(p: GuideFacts & { source_url?: string }): string[] {
  const urls: string[] = [];
  const basis = difficultyFrom(p).source_url;
  if (basis) urls.push(basis);
  const won = wonRound(p);
  if (won) urls.push(won.source_url, ...(won.examples ?? []).map((e) => e.source_url));
  if (p.focus) urls.push(p.focus.source_url);
  return [...new Set(urls)];
}

/** "What won last time" for the program's newest own round, else "What won before" (Ruling C3). */
export const wonHeading = (won: { own: boolean }) => (won.own ? 'What won last time' : 'What won before');

/** A guide source and what it backs (the page labels each link by its role, not its host). */
export type GuideSource = { label: string; url: string };

/**
 * Every source the guide's facts rest on, labelled by what it backs: "difficulty", "past winners",
 * "priorities". Deduped by URL (the first role wins); a role with several sources is numbered
 * ("past winners 1", "past winners 2"). Same URLs as guideSources. Pure.
 */
export function guideSourceList(p: GuideFacts & { source_url?: string }, first: GuideSource[] = []): GuideSource[] {
  const raw: GuideSource[] = [...first];
  const basis = difficultyFrom(p).source_url;
  const won = wonRound(p);
  if (won) for (const url of [won.source_url, ...(won.examples ?? []).map((e) => e.source_url)]) raw.push({ label: 'past winners', url });
  if (p.focus) raw.push({ label: 'priorities', url: p.focus.source_url });
  // The basis's source, when it isn't already cited for the round it was read from.
  if (basis) raw.push({ label: 'difficulty', url: basis });
  const seen = new Set<string>();
  const kept = raw.filter((s) => !seen.has(s.url) && seen.add(s.url));
  const total = new Map<string, number>();
  for (const s of kept) total.set(s.label, (total.get(s.label) ?? 0) + 1);
  const n = new Map<string, number>();
  return kept.map((s) => {
    if (total.get(s.label)! < 2) return s;
    n.set(s.label, (n.get(s.label) ?? 0) + 1);
    return { label: `${s.label} ${n.get(s.label)}`, url: s.url };
  });
}

/**
 * The guide as builder text: short sections, no paragraphs, empty sections left out (v2.10 item 3:
 * only sourced parts; the first prepare for a program shows it, tools.ts prepare_submission). Pure.
 */
export function guideText(g: Guide): string {
  const sections = [
    // v3.1 answerable replies (spec 4): the level only, never "(estimate)" (as the tables' Difficulty cell).
    [g.header, ...(g.opens_note ? [g.opens_note] : []), `Difficulty: ${difficultyText({ ...g.difficulty, estimate: false })}`].join('\n'),
    g.won && [wonHeading(g.won), ...(g.won.event ? [g.won.event] : []), ...g.won.lines.map((l) => `- ${l}`)].join('\n'),
    g.wants && `What ${g.wants.ecosystem} wants now\n- ${g.wants.areas.join(' · ')}`,
    // v2.10 item 3: only sourced parts; the rules fallback, one per line.
    !g.wants && g.rules_wants && ['What it wants', ...g.rules_wants.map((r) => `- ${r}`)].join('\n'),
    g.best_bet && `Most likely to win\n- ${g.best_bet}`,
  ];
  return sections.filter(Boolean).join('\n\n');
}
