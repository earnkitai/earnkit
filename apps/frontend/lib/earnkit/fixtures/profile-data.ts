import type { ProfileData } from '../bench-data';
import type { ProfileSite } from '../site-data';
import { SITE } from '../site-theme';

/** v2.13 T11: a rich profile (raising, a chain line, a Started card) for the profile's render and copy tests. */
export const DATA: ProfileData = {
  handle: 'maya_makes', name: 'Maya Chen', avatar: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', initials: 'M',
  backing: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1', backers: 0, earned_usd: 0 }, earned: { paid_usd: 0, waiting_usd: 0 }, bench: 'Top 4% of builders', rankListed: true, line: 'Shipping 62 · Top 4% of builders',
  chainLines: [{ chain: 'base', label: 'Base', line: 'Top 1% of builders on Base' }], score: 62,
  why: 'Code in 7 of the last 12 weeks, 3 of the last 4.', target: 'Code this week passes #2.', originality: 72, points: 0,
  grid: Array.from({ length: 52 }, (_, i) => ({ week: `2026-W${String((i % 52) + 1).padStart(2, '0')}`, on: i >= 46 })), streak: 6,
  log: [
    { week: '2026-10-12', text: 'Added fridge photo import, so it plans a week of meals from a picture.', chips: ['Went live', '12 commits', '6 weeks in a row'] },
    { week: '2026-10-05', text: null, chips: ['3 commits'] },
    { week: '2026-08-31', text: null, chips: [], started: 'Started tracking Recipe planner.' },
  ],
  project: { name: 'Recipe planner', what: 'a recipe planner', live: 'https://recipes.app', repo: 'https://github.com/maya/recipes', chains: ['base'],
    coin: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, programs: [{ title: 'Base Builder Grants', won: true, applied: true }], funds: ["Avalanche Team1 Mini Grants pays up to $10K; it's open all year."], confirmed: true },
  // v3 Stage 3: the Money tab's groups (the same facts the Project tab shows, structured).
  money: {
    fits: [{ title: 'Avalanche Team1 Mini Grants', prize: 'up to $10K', when: 'open all year', why: 'It fits your project.', href: '/programs/avalanche-team1-mini-grants' }],
    applied: [{ title: 'Base Builder Grants', status: 'won' }],
    backing: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1', backers: 0, earned_usd: 0 },
    points: 0,
  },
};

/**
 * v3.1 site Task 7: one ProfileData and ProfileSite per approved profile board (Profile: Jenil, BackedBuilder: Maya,
 * NewBuilder: Sam), with the board's own numbers. Times are relative to the import, so "2h ago" holds in a test run.
 */
const HOUR = 3_600_000;
/** The last 12 weeks of a 52-week grid from 12 on/off flags (the 40 older weeks off). */
const grid12 = (on: boolean[]): ProfileData['grid'] =>
  Array.from({ length: 52 }, (_, i) => ({ week: `2026-W${String(i + 1).padStart(2, '0')}`, on: i >= 40 ? on[i - 40] : false }));
const week = (monday: string, commits: number, summary: string): ProfileData['log'][number] => ({ week: monday, text: null, summary, chips: [`${commits} commits`], commits });

export const JENIL: ProfileData = {
  ...DATA,
  handle: 'jenilt', name: 'Jenil', avatar: 'https://pbs.twimg.com/profile_images/2/j_400x400.jpg', initials: 'J',
  backing: null, bench: null, rankListed: true, line: null, chainLines: [], score: 60, originality: 64, points: 1200, streak: 5,
  grid: grid12([false, false, true, false, false, true, false, true, true, true, true, true]),
  log: [
    week('2026-10-12', 279, 'Added Sign in with X at the install step, plus a fallback sign-in link.'),
    week('2026-10-05', 317, 'Rebuilt the leaderboard around one list and cut the first load in half.'),
    week('2026-09-28', 230, 'Shipped weekly updates written from the commits.'),
    week('2026-09-21', 120, 'Moved program guides into the repo.'),
    week('2026-09-14', 98, 'Added the Base Builder Code check.'),
    week('2026-08-24', 40, 'Started the builder score.'),
  ],
  project: {
    name: 'EarnKit', what: 'Connects builders with capital, from the agent they already use.', live: 'https://earnkit.com', repo: 'https://github.com/earnkitai/earnkit',
    chains: ['base'], coin: null, programs: [], funds: [], confirmed: true,
  },
  money: { fits: [], applied: [], backing: null, points: 1200 },
};
export const JENIL_SITE: ProfileSite = {
  lastShippedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  thisWeek: 14,
  highlights: [
    { icon: 'live', title: 'Live at earnkit.com', sub: 'Up 30 of the last 30 days', href: 'https://earnkit.com' },
    { icon: 'contract', title: '2 contracts on Base', sub: 'Since Sep 2026', href: `https://basescan.org/address/0x${'1'.repeat(40)}` },
    { icon: 'consistency', title: 'Shipped in 11 of the last 52 weeks', sub: 'Building EarnKit since Aug 2026', href: 'https://github.com/earnkitai/earnkit' },
    { icon: 'experience', title: 'Writing code since 2019', sub: 'On GitHub since Mar 2019', href: 'https://github.com/jenil' },
  ],
  standing: null,
  token: null,
  project: {
    name: 'EarnKit', about: 'Connects builders with capital, from the agent they already use.', link: { href: 'https://earnkit.com', text: 'earnkit.com' },
    repo: 'https://github.com/earnkitai/earnkit', onBase: true, earnkit: true, letter: 'E', color: SITE.logoBlue,
  },
  first: 'Jenil',
};

export const MAYA: ProfileData = {
  ...DATA,
  handle: 'maya', name: 'Maya', avatar: null, initials: 'M',
  backing: { symbol: 'TIPJAR', url: 'https://tokens.fun/c/tipjar', backers: 23, earned_usd: 412 },
  bench: 'Top 3% of builders', rankListed: true, line: 'Shipping 84 · Top 3% of builders', score: 84, streak: 9,
  grid: grid12([true, true, false, true, true, true, true, true, true, true, true, true]),
  log: [
    week('2026-10-12', 42, 'Shipped tips in USDC on Base.'),
    week('2026-10-05', 18, 'Added a tip page per creator.'),
    week('2026-09-28', 31, 'Cut the checkout to one tap.'),
    week('2026-09-21', 12, 'Started the tip jar.'),
  ],
  project: {
    name: 'Tipjar', what: 'Tips for creators, paid in USDC on Base.', live: 'https://tipjar.xyz', repo: 'https://github.com/maya/tipjar',
    chains: ['base'], coin: { symbol: 'TIPJAR', url: 'https://tokens.fun/c/tipjar' }, programs: [], funds: [], confirmed: true,
  },
};
export const MAYA_SITE: ProfileSite = {
  lastShippedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  thisWeek: 6,
  highlights: [
    { icon: 'live', title: 'Live at tipjar.xyz', sub: 'Since Sep 2026', href: 'https://tipjar.xyz' },
    { icon: 'products', title: 'Shipped 2 products', sub: 'tipjar.xyz, tips.maya.dev', href: 'https://tipjar.xyz' },
    { icon: 'consistency', title: 'Shipped in 11 of the last 52 weeks', sub: 'Building Tipjar since Aug 2026', href: 'https://github.com/maya/tipjar' },
    { icon: 'won', title: 'Won Base Builder Grant Program', sub: 'Oct 2026', href: '/programs/base-builder-grants' },
  ],
  standing: { label: 'Top 3% of builders', tier: 'gold', title: 'Top 3% of builders' },
  token: { symbol: 'TIPJAR', url: 'https://tokens.fun/c/tipjar', backers: 23, fees_usd: 412, weeks: [0, 1, 0, 2, 1, 3, 2, 4, 3, 2, 5, 4], letter: 'T', color: SITE.logoOrange, photo: null },
  project: {
    name: 'Tipjar', about: 'Tips for creators, paid in USDC on Base.', link: { href: 'https://tipjar.xyz', text: 'tipjar.xyz' },
    repo: 'https://github.com/maya/tipjar', onBase: true, earnkit: false, letter: 'T', color: SITE.logoOrange,
  },
  first: 'Maya',
};

export const SAM: ProfileData = {
  ...DATA,
  handle: 'sam', name: 'Sam', avatar: null, initials: 'S',
  backing: null, bench: null, rankListed: false, line: null, chainLines: [], score: null, why: null, target: null, originality: null, points: 0, streak: 1,
  grid: grid12([false, false, false, false, false, false, false, false, false, false, false, true]),
  log: [week('2026-10-12', 9, 'Started the ledger: a monthly statement from one wallet.')],
  project: {
    name: 'Ledgerly', what: null, live: null, repo: 'https://github.com/sam/ledgerly', chains: ['base'], coin: null, programs: [], funds: [], confirmed: true,
  },
  money: { fits: [], applied: [], backing: null, points: 0 },
};
export const SAM_SITE: ProfileSite = {
  lastShippedAt: new Date(Date.now() - 72 * HOUR).toISOString(),
  thisWeek: 0,
  highlights: [
    { icon: 'consistency', title: 'Shipped in 1 of the last 52 weeks', sub: 'Building Ledgerly since Oct 2026', href: 'https://github.com/sam/ledgerly' },
    { icon: 'experience', title: 'Writing code since 2021', sub: 'On GitHub since Jun 2021', href: 'https://github.com/sam' },
  ],
  standing: null,
  token: null,
  project: {
    name: 'Ledgerly', about: null, link: { href: 'https://github.com/sam/ledgerly', text: 'github.com/sam/ledgerly' },
    repo: 'https://github.com/sam/ledgerly', onBase: true, earnkit: false, letter: 'L', color: SITE.logoViolet,
  },
  first: 'Sam',
};

/** A ProfileSite for any ProfileData (the page's own reads, quiet: no push, no standing, no Token card), with overrides. Pure. */
export const siteOf = (d: ProfileData, o: Partial<ProfileSite> = {}): ProfileSite => {
  const p = d.project;
  const href = p ? (p.live ?? p.repo) : null;
  return {
    lastShippedAt: null,
    thisWeek: 0,
    highlights: [{ icon: 'start', title: 'On EarnKit since Oct 1', sub: 'No project on the leaderboard yet' }],
    standing: null,
    token: null,
    project: p
      ? {
          name: p.name, about: p.what, link: href ? { href, text: href.replace(/^https?:\/\//, '') } : null, repo: p.repo,
          onBase: p.chains.includes('base'), earnkit: false, letter: p.name.charAt(0).toUpperCase(), color: SITE.logoBlue,
        }
      : null,
    first: d.name.trim().split(/\s+/)[0] || d.handle,
    ...o,
  };
};
