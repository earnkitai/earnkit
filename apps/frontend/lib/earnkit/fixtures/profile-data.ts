import type { ProfileData } from '../bench-data';

/** v2.13 T11: a rich profile (raising, a chain line, a Started card) for the profile's render and copy tests. */
export const DATA: ProfileData = {
  handle: 'maya_makes', name: 'Maya Chen', avatar: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', initials: 'M',
  raising: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, bench: 'Top 4% of builders this week', line: 'Shipping 62 · Top 4% of builders this week',
  chainLines: [{ chain: 'base', label: 'Base', line: 'Top 1% of builders on Base this week' }], score: 62,
  why: 'Code in 7 of the last 12 weeks, 3 of the last 4.', target: 'Ship code this week: +14 points, enough to reach #2.', originality: 72,
  grid: Array.from({ length: 52 }, (_, i) => ({ week: `2026-W${String((i % 52) + 1).padStart(2, '0')}`, on: i >= 46 })), streak: 6,
  log: [
    { week: '2026-10-12', text: 'Added fridge photo import, so it plans a week of meals from a picture.', chips: ['Went live', '12 commits', '6 weeks in a row'] },
    { week: '2026-10-05', text: null, chips: ['3 commits'] },
    { week: '2026-08-31', text: null, chips: [], started: 'Started tracking Recipe planner.' },
  ],
  project: { name: 'Recipe planner', what: 'a recipe planner', live: 'https://recipes.app', repo: 'https://github.com/maya/recipes', chains: ['base'],
    coin: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, programs: [{ title: 'Base Builder Grants', won: true }], funds: ["Avalanche Team1 Mini Grants pays up to $10K; it's open all year."], confirmed: true },
};
