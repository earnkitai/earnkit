import type { ProfileData } from '../bench-data';

/** v2.13 T11: a rich profile (raising, a chain line, a Started card) for the profile's render and copy tests. */
export const DATA: ProfileData = {
  handle: 'maya_makes', name: 'Maya Chen', avatar: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', initials: 'M',
  backing: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1', backers: 0, earned_usd: 0 }, earned: { paid_usd: 0, waiting_usd: 0 }, bench: 'Top 4% of builders', rankListed: true, line: 'Shipping 62 · Top 4% of builders',
  chainLines: [{ chain: 'base', label: 'Base', line: 'Top 1% of builders on Base' }], score: 62,
  why: 'Code in 7 of the last 12 weeks, 3 of the last 4.', target: 'Code this week adds +14 points, enough to pass #2.', originality: 72, points: 0,
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
