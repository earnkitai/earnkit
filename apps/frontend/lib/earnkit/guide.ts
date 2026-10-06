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
  | 'title'
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
 * Whether a past round is this program's own (its label starts with the program's title). Any
 * other round is a predecessor event (Ruling C2), so the basis names it instead of "last round".
 */
const ownRound = (title: string, r: PastRound) =>
  r.label.toLowerCase().startsWith(title.toLowerCase());

/** The round difficulty's odds come from: the newest with both counts (Ruling 2 (plan)). */
const countedRound = (p: GuideFacts) =>
  p.past_rounds.find((r) => r.submissions && r.winners) ?? null;

/** "last round" for the program's own newest round, else "in <label>". */
const when = (p: GuideFacts, r: PastRound) =>
  r === p.past_rounds[0] && ownRound(p.title, r) ? 'last round' : `in ${r.label}`;

/** v2.7 §2, Rulings 2-5 (plan): the program's difficulty from its own data. Pure. */
export function difficultyOf(p: GuideFacts): Difficulty {
  const o = p.difficulty_override;
  if (o) return { level: o.level, estimate: false, basis: o.basis };
  const newest = p.past_rounds[0] ?? null;
  const counted = countedRound(p);
  if (counted) {
    const odds = counted.winners! / counted.submissions!;
    const level: Level =
      odds >= ODDS_BANDS.easy ? 'Easy' : odds >= ODDS_BANDS.medium ? 'Medium' : 'Hard';
    return {
      level,
      estimate: false,
      basis: `${counted.winners} of ~${counted.submissions} entries won ${when(p, counted)}`,
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
  const basis =
    winners === null
      ? 'no past results yet'
      : newest?.winners
        ? `${winners} winners ${when(p, newest)}; entry count not published`
        : `${winners} winners per round; no past results yet`;
  return { level: score < 0 ? 'Hard' : 'Medium', estimate: true, basis };
}

/** The Difficulty cell: "Medium", "Hard (estimate)". Pure. */
export const difficultyLabel = (d: Difficulty) => (d.estimate ? `${d.level} (estimate)` : d.level);

export type Guide = {
  /** "Arc Microgrants · 500 USDC × 20 grants · ends Oct 14". */
  header: string;
  difficulty: Difficulty;
  /** Theme lines, then example lines, without "- ". */
  won: { lines: string[]; source_url: string } | null;
  wants: { ecosystem: string; areas: string[]; source_url: string } | null;
  best_bet: string | null;
  /** board: "earnkit.com/bonus/<slug>". */
  bonus: { cell: string; board: string } | null;
};

/** The round "What won last time" uses: the newest with themes or examples. */
const wonRound = (p: Pick<GuideFacts, 'past_rounds'>) =>
  p.past_rounds.find((r) => r.themes?.length || r.examples?.length) ?? null;

/** "What won last time" (Ruling 9 (plan)): the top 3 themes by count, then the examples. Pure. */
function wonLines(r: PastRound): string[] {
  const themes = [...(r.themes ?? [])].sort((a, b) => b.count - a.count).slice(0, 3);
  return [
    ...themes.map((t, i) => {
      const unit = i === 0 ? ' winners' : '';
      return `${t.theme} (${r.winners ? `${t.count} of ${r.winners}${unit}` : `${t.count}${unit}`})`;
    }),
    // Task 1 carry: "cited for" only when a judge or organizer said why.
    ...(r.examples ?? []).map((e) => `Example: ${e.name} — ${e.what}${e.why ? `; cited for ${e.why}` : ''}`),
  ];
}

/** v2.7 §2: the guide for one curated program. Pure. */
export function programGuide(
  p: GuideFacts & Pick<ProgramRow, 'summary' | 'ends_at' | 'status'>,
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
    won: won ? { lines: wonLines(won), source_url: won.source_url } : null,
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

/** Every source_url the guide's facts come from, deduped. Pure. */
export function guideSources(p: GuideFacts): string[] {
  const urls: string[] = [];
  if (p.difficulty_override) urls.push(p.difficulty_override.source_url);
  else {
    const counted = countedRound(p);
    const newest = p.past_rounds[0];
    if (counted) urls.push(counted.source_url);
    else if (newest?.winners) urls.push(newest.source_url);
  }
  const won = wonRound(p);
  if (won) urls.push(won.source_url, ...(won.examples ?? []).map((e) => e.source_url));
  if (p.focus) urls.push(p.focus.source_url);
  return [...new Set(urls)];
}

/** The guide as builder text: short sections, no paragraphs, empty sections left out. Pure. */
export function guideText(g: Guide): string {
  const sections = [
    `${g.header}\nDifficulty: ${difficultyLabel(g.difficulty)} — ${g.difficulty.basis}`,
    g.won && ['What won last time', ...g.won.lines.map((l) => `- ${l}`)].join('\n'),
    g.wants && `What ${g.wants.ecosystem} wants now\n- ${g.wants.areas.join(' · ')}`,
    g.best_bet && `Your best bet\n- ${g.best_bet}`,
    g.bonus && `Builder bonus: ${g.bonus.cell} · ${g.bonus.board}`,
  ];
  return sections.filter(Boolean).join('\n\n');
}
