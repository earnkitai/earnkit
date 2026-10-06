import { endsOf, prizeOf } from './entry-text';
import { CHAIN_NAMES } from './match';
import type { PastRound } from './program-file';
import type { ProgramRow } from './programs';

/**
 * v2.7 §2: a program's guide (difficulty, what won before, what the ecosystem wants, the best bet,
 * the builder bonus). One renderer for get_program, the cards and the /programs/<id> page. Pure.
 */
export type Level = 'Easy' | 'Medium' | 'Hard';
export type Difficulty = { level: Level; estimate: boolean; basis: string };

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
>;

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
  const o = p.difficulty_override;
  if (o) return { difficulty: { level: o.level, estimate: false, basis: o.basis }, source_url: o.source_url };
  const newest = p.past_rounds[0] ?? null;
  // Ruling 2 (plan): odds from the newest round with both counts.
  const counted = p.past_rounds.find((r) => r.submissions && r.winners);
  if (counted) {
    const odds = counted.winners! / counted.submissions!;
    const level: Level =
      odds >= ODDS_BANDS.easy ? 'Easy' : odds >= ODDS_BANDS.medium ? 'Medium' : 'Hard';
    return {
      difficulty: { level, estimate: false, basis: `${counted.winners} of ~${counted.submissions} entries won ${when(p, counted)}` },
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
  const est = (basis: string, source_url: string | null) => ({ difficulty: { level, estimate: true, basis }, source_url });
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

/** The Difficulty cell: "Medium", "Hard (estimate)". Pure. */
export const difficultyLabel = (d: Difficulty) => (d.estimate ? `${d.level} (estimate)` : d.level);

export type Guide = {
  /** "Arc Microgrants · 500 USDC × 20 grants · ends Oct 14". */
  header: string;
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
  best_bet: string | null;
  /** board: "earnkit.com/bonus/<slug>". */
  bonus: { cell: string; board: string } | null;
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
    ...(r.examples ?? []).map((e) => `Example: ${e.name} — ${e.what}${e.why ? `; cited for ${e.why}` : ''}`),
  ];
}

/** v2.7 §2: the guide for one curated program. Pure. */
export function programGuide(
  p: GuideFacts & Pick<ProgramRow, 'title' | 'summary' | 'ends_at' | 'status'>,
  bonus: { cell: string; board: string } | null,
  now = new Date(),
): Guide {
  const closed = p.status !== 'active' || (p.ends_at !== null && p.ends_at <= now);
  const ends = endsOf(p);
  const end = closed ? 'closed' : ends === 'rolling' ? 'rolling' : `ends ${ends}`;
  const won = wonRound(p);
  return {
    header: `${p.title} · ${prizeOf(p)} · ${end}`,
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
    best_bet: p.best_bet ?? null,
    bonus,
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

/** The guide as builder text: short sections, no paragraphs, empty sections left out. Pure. */
export function guideText(g: Guide): string {
  const sections = [
    `${g.header}\nDifficulty: ${difficultyLabel(g.difficulty)} — ${g.difficulty.basis}`,
    g.won && [wonHeading(g.won), ...(g.won.event ? [g.won.event] : []), ...g.won.lines.map((l) => `- ${l}`)].join('\n'),
    g.wants && `What ${g.wants.ecosystem} wants now\n- ${g.wants.areas.join(' · ')}`,
    g.best_bet && `Your best bet\n- ${g.best_bet}`,
    g.bonus && `Builder bonus: ${g.bonus.cell} · ${g.bonus.board}`,
  ];
  return sections.filter(Boolean).join('\n\n');
}
