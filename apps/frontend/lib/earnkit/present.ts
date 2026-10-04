import { usd } from './campaigns';
import { shortDate } from './dates';
import { EFFORT_ORDER, type Effort, type Verdict } from './match';

/**
 * The builder-facing text for list_programs (v2.4 §1): money first, markdown tables, no emojis.
 * Built on the server because many MCP clients never show the model the server instructions; a
 * ready-made result gets shown as written. Order, always: "Since you last checked", EarnKit's own
 * campaigns, what the builder's repos qualify for, other open programs (at most 5), sponsor
 * campaigns (never first), then one offer.
 */
export type Card = {
  id: string;
  title: string;
  summary: string;
  tag: string | null;
  each_time: string[];
  ends_at?: Date | null;
  /** Opened since the builder's last check. */
  is_new?: boolean;
  /** Whole days until the deadline, when it's 3 or fewer. */
  closes_in_days?: number | null;
  /** The known per-winner award in USD (programs.ts perWinnerUsd); unknown sorts last. */
  max_award_usd?: number | null;
  /**
   * A sponsor campaign (verified or not): its own section after curated programs, never in a
   * repo's table, the closing offer or by name in the alerts (re-audit H4, M6).
   */
  sponsored?: boolean;
  /** Required answers only the builder can give (personal info, forms). */
  builder_fields?: number;
};

/** One EarnKit campaign row (leaderboard.ts campaignRow). */
export type CampaignRow = {
  id: string;
  title: string;
  /** "$100 each to top 5 (in MINI)". */
  prize: string;
  prize_usd_each: number;
  ends_at: Date;
  entries: number;
  /**
   * The score of the last payable pick (winners.ts pickWinners: min score, vetoes, one prize per
   * wallet and agent) when all prizes are taken, else null.
   */
  cutoff: number | null;
  /** Entries with a score; 0 before the first scoring. */
  scored: number;
  winners: number;
  /** Users an entry needs to win anything. */
  min_score: number;
  /** The builder's standing (winners.ts standingText), or null without an entry. */
  you: string | null;
  open: boolean;
};

export type FirstMessage = {
  /** "Since you last checked" items, money first (alerts.ts, then programAlerts). */
  alerts: string[];
  campaigns: CampaignRow[];
  /** Open programs that aren't EarnKit campaigns (curated and sponsored). */
  cards: Card[];
  repos: YourRepos | null;
  workingOn: string[];
  agentCanBuild: boolean;
  /** "Your campaign entries" for sponsor campaigns (campaigns.ts presentYourEntries), or null. */
  sponsorEntries: string | null;
  now: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows in "Also open" (spec §1). */
const MAX_OTHERS = 5;

/** Days until a deadline if it's within 3 days, else null. */
export function closesInDays(endsAt: Date | null, now = new Date()) {
  if (!endsAt) return null;
  const days = Math.floor((endsAt.getTime() - now.getTime()) / DAY_MS);
  return days <= 3 ? Math.max(days, 0) : null;
}

const soon = (days: number) =>
  days === 0 ? 'closes today' : `closes in ${days} day${days === 1 ? '' : 's'}`;

/** The builder's repos checked against open programs (only verdicts that can earn), or why not. */
export type YourRepos =
  | {
      checked: number;
      /** repo_url is null for private/local repos the agent reported. */
      fits: { repo: string; repo_url: string | null; verdicts: Verdict[] }[];
    }
  | { error: string };

/**
 * "Since you last checked" items about programs: new curated ones by name, new sponsored ones
 * counted (re-audit H4), curated ones closing within 3 days. None on a first check. Pure.
 */
export function programAlerts(cards: Card[], firstCheck: boolean): string[] {
  if (firstCheck) return [];
  const named = cards.filter((c) => !c.sponsored);
  const sponsoredNew = cards.filter((c) => c.sponsored && c.is_new).length;
  return [
    ...named.filter((c) => c.is_new).map((c) => `new: ${c.title}`),
    ...(sponsoredNew > 0
      ? [`${sponsoredNew} new sponsored campaign${sponsoredNew === 1 ? '' : 's'}`]
      : []),
    ...named
      .filter((c) => c.closes_in_days != null)
      .map((c) => `${c.title} ${soon(c.closes_in_days!)}`),
  ];
}

/** A markdown table; "|" is escaped and line breaks folded so a cell can't break it. Pure; exported for tests. */
export function table(head: string[], rows: string[][]) {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

/** The prize part of a program's summary ("500 USDC × 20 grants"). */
const prizeOf = (c: Card) => c.summary.split(' · ')[0];

/** "Oct 14" from the summary's "closes Oct 14, …", "rolling", else ends_at's UTC day. Pure; exported for tests. */
export function endsOf(c: Card) {
  for (const part of c.summary.split(' · ').slice(1)) {
    const m = /^closes (\w{3} \d{1,2})\b/.exec(part);
    if (m) return m[1];
    if (part === 'rolling') return 'rolling';
  }
  return c.ends_at ? shortDate(c.ends_at) : 'rolling';
}

/** Whole UTC calendar days from now to the end: "ends today" only on the last day. */
const left = (endsAt: Date, now: Date) => {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((day(endsAt) - day(now)) / DAY_MS);
  return days <= 0 ? 'ends today' : `${days} day${days === 1 ? '' : 's'} left`;
};

/** A campaign's "You" cell without an entry: "12 entered, #5 has 14 users". Pure; exported for tests. */
export function fieldText(r: CampaignRow) {
  if (r.entries === 0) return 'no entries yet';
  if (r.scored === 0) return `${r.entries} entered, not scored yet`;
  return r.cutoff === null
    ? `${r.entries} entered, top ${r.winners} not full (${r.min_score} users to qualify)`
    : `${r.entries} entered, #${r.winners} has ${r.cutoff} users`;
}

/** Hours of builder effort per verdict effort, for "fastest" (v2.4 §6). */
const EFFORT_HOURS: Record<Effort, number> = { none: 0.5, minutes: 0.5, hours: 4, days: 24, weeks: 120 };

/** Programs needing videos or forms (each-time items, or more than 2 answers only the builder can give) never go first. Pure. */
export const needsForms = (c: Card) => c.each_time.length > 0 || (c.builder_fields ?? 0) > 2;

/** Known prize per hour of builder effort. Pure; exported for tests. */
export const prizePerHour = (c: Card, v: Verdict) => (c.max_award_usd ?? 0) / EFFORT_HOURS[v.effort];

const quickness = (v: Verdict) => (v.status === 'likely' ? 0 : 10) + EFFORT_ORDER.indexOf(v.effort);

/** Larger known per-winner prize first (unknown last), then the earlier deadline (rolling last). */
const byPrize = (a: Card, b: Card) =>
  (b.max_award_usd ?? -1) - (a.max_award_usd ?? -1) ||
  (a.ends_at?.getTime() ?? 8.64e15) - (b.ends_at?.getTime() ?? 8.64e15);

/** EarnKit campaigns: the larger prize per winner first, then the earlier end (controller ruling 12). */
const byCampaignPrize = (a: CampaignRow, b: CampaignRow) =>
  b.prize_usd_each - a.prize_usd_each || a.ends_at.getTime() - b.ends_at.getTime();

const TELL_WHEN_OPENS = 'Want me to tell you when something opens?';

const CHAT_ONLY =
  "I can't build or deploy from here, but I can plan it and write every answer for you to submit. To have it done for you, add EarnKit to a coding agent (Claude Code, Cursor, Codex).";

/** The first message: see the type and the module comment for the order. Pure; exported for tests. */
export function presentFirstMessage(m: FirstMessage): string {
  const sections: string[] = [];
  if (m.alerts.length) sections.push(`Since you last checked: ${m.alerts.join('; ')}.`);
  if (m.campaigns.length === 0 && m.cards.length === 0)
    return [...sections, `Nothing is open right now. ${TELL_WHEN_OPENS}`].join('\n\n');

  if (m.campaigns.length > 0)
    sections.push(
      table(
        ['Win', 'Prize', 'Ends', 'You'],
        [...m.campaigns].sort(byCampaignPrize).map((r) => [
          r.title,
          r.prize,
          r.open ? `${shortDate(r.ends_at)}, ${left(r.ends_at, m.now)}` : `ended ${shortDate(r.ends_at)}`,
          r.you ?? fieldText(r),
        ]),
      ),
    );

  // What the builder's repos qualify for: each curated program once, under the repo that fits it
  // best, sorted by prize per winner.
  const byId = new Map(m.cards.map((c) => [c.id, c]));
  const curated = (id: string) => byId.has(id) && !byId.get(id)!.sponsored;
  const fits = m.repos && 'fits' in m.repos ? m.repos.fits : [];
  const matched = new Map<string, { card: Card; repo: string; v: Verdict }>();
  for (const f of fits)
    for (const v of [...f.verdicts].sort((a, b) => quickness(a) - quickness(b)))
      if (v.status !== 'no' && curated(v.program_id) && !matched.has(v.program_id))
        matched.set(v.program_id, { card: byId.get(v.program_id)!, repo: f.repo, v });
  const rows = [...matched.values()].sort((a, b) => byPrize(a.card, b.card));
  if (m.repos && 'error' in m.repos) sections.push(`Couldn't read your repos: ${m.repos.error}`);
  else if (m.repos && rows.length === 0)
    sections.push(
      `None of your ${m.repos.checked} repo${m.repos.checked === 1 ? '' : 's'} fits an open program yet.`,
    );
  else if (rows.length > 0)
    sections.push(
      `${rows.every((r) => r.v.status === 'likely') ? 'Your repos already qualify for:' : 'Your repos can enter:'}\n\n` +
        table(
          ['Program', 'Prize', 'Ends', 'Repo'],
          rows.map(({ card, repo, v }) => [
            card.title,
            prizeOf(card),
            endsOf(card),
            v.status === 'likely' || !v.note ? repo : `${repo}, ${v.note}`,
          ]),
        ),
    );

  const rest = m.cards.filter((c) => !c.sponsored && !matched.has(c.id)).sort(byPrize);
  if (rest.length > 0) {
    const shown = rest.slice(0, MAX_OTHERS);
    const more = rest.length - shown.length;
    const above = m.campaigns.length > 0 || rows.length > 0;
    sections.push(
      `${above ? 'Also open:' : 'Open now:'}\n\n` +
        table(['Program', 'Prize', 'Ends'], shown.map((c) => [c.title, prizeOf(c), endsOf(c)])) +
        (more > 0 ? `\n\n${more} more open: ask me for the full list.` : ''),
    );
  }

  const sponsored = m.cards.filter((c) => c.sponsored);
  if (sponsored.length > 0)
    sections.push(
      "Sponsored (set by sponsors; EarnKit didn't write or check them):\n\n" +
        table(['Campaign', 'Details'], sponsored.map((c) => [c.title, c.summary])),
    );
  if (m.sponsorEntries) sections.push(m.sponsorEntries);

  sections.push(offer(m, byId, rows));
  return sections.join('\n\n');
}

/**
 * One closing offer, never a menu and never a sponsor campaign (fix round 1, I3). In order: keep
 * going on what they're preparing; build an entry for an open EarnKit campaign; the quickest fit
 * without forms; a fit that needs forms, saying what only they can give; with no repos known, check
 * them; with repos known and no fit, the top program without forms; else wait for results or news.
 */
function offer(
  m: FirstMessage,
  byId: Map<string, Card>,
  rows: { card: Card; repo: string; v: Verdict }[],
) {
  if (!m.agentCanBuild) return CHAT_ONLY;
  const titleOf = (id: string) => {
    const c = byId.get(id);
    if (c) return c.sponsored ? undefined : c.title;
    return m.campaigns.find((r) => r.id === id && r.open)?.title;
  };
  const resume = m.workingOn.map(titleOf).find(Boolean);
  if (resume) return `Want me to keep going on ${resume}?`;
  const campaign = [...m.campaigns].sort(byCampaignPrize).find((r) => r.open && r.you === null);
  if (campaign) return `Want me to build your entry for the ${usd(campaign.prize_usd_each)}?`;
  const byHour = [...rows].sort(
    (a, b) => prizePerHour(b.card, b.v) - prizePerHour(a.card, a.v) || quickness(a.v) - quickness(b.v),
  );
  const fastest = byHour.find((r) => !needsForms(r.card));
  if (fastest) return `Want me to start on ${fastest.card.title} with ${fastest.repo}?`;
  const forms = byHour[0];
  if (forms) {
    const needs = forms.card.each_time[0]
      ? `${forms.card.each_time[0]} from you`
      : `${forms.card.builder_fields} answers only you can give`;
    return `Want me to start on ${forms.card.title} with ${forms.repo}? It needs ${needs}.`;
  }
  const curated = m.cards.filter((c) => !c.sponsored);
  const anyOpen = curated.length > 0 || m.campaigns.some((r) => r.open);
  if (anyOpen && (!m.repos || 'error' in m.repos)) return 'Want me to check which of your repos already qualify?';
  const top = curated.filter((c) => !needsForms(c)).sort(byPrize)[0];
  if (top) return `Want me to start on ${top.title} (${prizeOf(top)})?`;
  // Only sponsor campaigns open: never offered by name.
  if (m.cards.length > 0) return "Pick one and I'll start.";
  if (m.campaigns.some((r) => r.you === 'in review'))
    return 'Nothing else is open right now. Want me to tell you when the results are in?';
  return `Nothing else is open right now. ${TELL_WHEN_OPENS}`;
}
