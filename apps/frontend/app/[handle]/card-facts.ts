import type { ProfileData } from '../../lib/earnkit/bench-data';
import { BACKERS_SHOWN_FROM } from '../../lib/earnkit/post-card';
import { pageUrl } from '../../lib/earnkit/reserved-routes';
import { STARTING_ON_BASE, type Highlight, type ProfileSite } from '../../lib/earnkit/site-data';

/**
 * GTM W4 (2026-10-23): what the share card (/<handle>/card.png) shows, from the page's own reads (profileData and
 * profileSite), so the card never says what the page doesn't. Verified facts only, each in the page's own words
 * (Highlights' titles and sub lines, the rank helpers' line); never a hidden repo's or a confirming project's name.
 *
 * - `project`: the one Bench-confirmed project (the profile's project panel), its verified live host (Highlights'
 *   "Live at <host>") and up to two quiet facts under it ("Building since Mar 2025", from Highlights' consistency sub
 *   line, "6 weeks in a row").
 * - `tiles`: at most two big facts beside the hero, in order: the Shipping ring (only while ranked, with the rank line
 *   from rank.ts when the pool shows one), the builder's token (site.token: launched; holders only from
 *   BACKERS_SHOWN_FROM), a win, the streak. v3.1 Highlights competence (2026-10-25): no commits tile, since the page
 *   no longer shows a commit count (owner: commit counts are trivia).
 * - No confirmed project: one calm line ("Getting started on Base" when the builder said yes to the Base walk-through,
 *   else "Building with AI") and when they joined, so the card is never near-empty.
 */
export type CardTile =
  | { kind: 'score'; score: number; rank: string | null }
  | { kind: 'backing'; symbol: string; backers: number | null }
  | { kind: 'won'; program: string; when: string }
  | { kind: 'streak'; weeks: number };

export type CardProject = {
  name: string; letter: string; color: string; onBase: boolean;
  /** EarnKit's own repo: its mark instead of the letter (the profile's panel). */
  earnkit?: boolean;
  /** The verified live host ("mealmate.app"), else null. */
  live: string | null;
  /** Up to two quiet facts under the name. */
  facts: string[];
};

export type ShareCardFacts = {
  handle: string; name: string; avatar: string | null; url: string;
  project: CardProject | null;
  /** No confirmed project: the calm line and its sub line. */
  idle: { line: string; sub: string } | null;
  tiles: CardTile[];
};

export const TILES_MAX = 2;
export const BUILDING_WITH_AI = 'Building with AI';

const icon = (items: Highlight[], k: Highlight['icon']) => items.filter((h) => h.icon === k);
/** The consistency item's sub "Building recipes since Mar 2025" → "Building since Mar 2025" (the name already sits above it). Pure. */
const sinceOf = (h: Highlight | undefined) => {
  const m = h ? /since ([A-Z][a-z]{2} \d{4})$/.exec(h.sub) : null;
  return m ? `Building since ${m[1]}` : null;
};
const streakText = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'} in a row`;

/** The share card's facts from the page's reads. Pure. */
export function shareCardFacts(d: ProfileData, site: ProfileSite): ShareCardFacts {
  const base = { handle: d.handle, name: d.name, avatar: d.avatar, url: pageUrl(d.handle) };
  const confirmed = d.project?.confirmed === true && site.project !== null;
  if (!confirmed) {
    const start = icon(site.highlights, 'start')[0];
    return {
      ...base,
      project: null,
      idle: { line: site.starting ? STARTING_ON_BASE : BUILDING_WITH_AI, sub: start?.title ?? '' },
      tiles: [],
    };
  }
  const items = site.highlights;
  const live = icon(items, 'live')[0];
  const won = icon(items, 'won')[0];
  const streak = d.streak;
  const all: CardTile[] = [];
  if (d.rankListed && d.score !== null) all.push({ kind: 'score', score: d.score, rank: d.bench });
  if (site.token) all.push({ kind: 'backing', symbol: site.token.symbol, backers: site.token.backers >= BACKERS_SHOWN_FROM ? site.token.backers : null });
  if (won) all.push({ kind: 'won', program: won.title.replace(/^Won /, ''), when: won.sub });
  if (streak >= 1) all.push({ kind: 'streak', weeks: streak });
  const since = sinceOf(icon(items, 'consistency')[0]);
  const tiles = all.slice(0, TILES_MAX);
  const shown = new Set(tiles.map((t) => t.kind));
  // What did not get a tile reads small under the project's name.
  const facts = [
    !shown.has('streak') && streak >= 2 ? streakText(streak) : null,
    since,
    !shown.has('won') && won ? won.title : null,
  ].filter((x): x is string => Boolean(x)).slice(0, 2);
  const p = site.project!;
  return {
    ...base,
    project: { name: p.name, letter: p.letter, color: p.color, onBase: p.onBase, earnkit: p.earnkit, live: live ? live.title.replace(/^Live at /, '') : null, facts },
    idle: null,
    tiles,
  };
}
