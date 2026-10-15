import type { ProfileData } from '../bench-data';

/** v2.13 T11: a rich profile (raising, a chain line, a Started card) for the profile's render and copy tests. */
export const DATA: ProfileData = {
  handle: 'maya_makes', name: 'Maya Chen', avatar: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', initials: 'M',
  raising: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, bench: 'Top 4% on the Bench',
  chainLines: [{ chain: 'base', label: 'Base', line: 'Top 1% on Base' }], score: 62,
  parts: [{ label: 'Shipped', points: 15, max: 20 }, { label: 'Used', points: 24, max: 40 }, { label: 'Earned', points: 8, max: 20 }, { label: 'Consistency', points: 15, max: 20 }],
  grid: Array.from({ length: 52 }, (_, i) => ({ week: `2026-W${String((i % 52) + 1).padStart(2, '0')}`, on: i >= 46 })), streak: 6,
  log: [
    { week: '2026-10-12', text: 'Added fridge photo import, so it plans a week of meals from a picture.', chips: ['Went live', '+31 people', '12 commits', '6 weeks in a row'] },
    { week: '2026-10-05', text: null, chips: ['3 commits'] },
    { week: '2026-08-31', text: null, chips: [], started: 'Started tracking Recipe planner.' },
  ],
  project: { name: 'Recipe planner', what: 'a recipe planner', live: 'https://recipes.app', repo: 'https://github.com/maya/recipes', chains: ['base'], people: 31, money: '$120',
    coin: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, programs: [{ title: 'Base Builder Grants', won: true }], funds: ["Avalanche Team1 Mini Grants pays up to $10K; it's open all year."], confirmed: true },
};
