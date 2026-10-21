import { LIVE_BONUS } from './score-v2';

/**
 * v3.1 site Task 10 (Docs board): every string on /docs. The agents' install steps and commands are not here: the
 * install card reads them from AGENTS (app/components/sections/agents.tsx), so the sheet and the page never differ.
 * Backing words only while raisingEnabled(): `docsNav` and `docsMoney` drop them with the flag off.
 * Pinned by v31-site-docs.test.ts and v3-docs.test.ts: under 250 words on the page, no em dash, no emoji, no points.
 */
export const DOCS_NAV: [string, string][] = [
  ['#install', 'Install'],
  ['#week', 'How the week works'],
  ['#score', 'Shipping score'],
  ['#money', 'Programs and Backing'],
  ['#selectors', 'For selectors'],
];

export const DOCS_INSTALL_TITLE = 'Add EarnKit to your agent';
export const DOCS_STEPS = ['Add the server', 'Sign in with X', 'Ask: what can I earn?'];

export const DOCS_WEEK = {
  title: 'How the week works',
  text: 'Ship during the week. Monday, EarnKit writes your update from the commits and emails it. One tap posts it.',
};
/** The real scoring (score-v2.ts): weeks with code over the last 12, plus LIVE_BONUS for a live product. */
export const DOCS_SCORE = {
  title: 'Shipping score',
  text: `0 to 100 over 12 weeks. Weeks with real code count, not commit volume. A live product adds ${LIVE_BONUS}.`,
};
export const DOCS_MONEY = {
  title: 'Programs and Backing',
  text: 'Your agent drafts applications from your Activity.',
  backing: 'Backing lets people buy your coin; you keep 40% of fees.',
};
/** The money card's title with Backing off. */
export const DOCS_MONEY_OFF_TITLE = 'Programs';

export const DOCS_SELECTORS = {
  title: 'For selectors',
  text: "Every builder's standing as JSON.",
  url: 'earnkit.com/api/builders/<handle>.json',
};

/** The side nav: the money link reads "Programs" while Backing is off. */
export const docsNav = (raising: boolean): [string, string][] =>
  raising ? DOCS_NAV : DOCS_NAV.map(([href, label]) => [href, href === '#money' ? DOCS_MONEY_OFF_TITLE : label]);

/** The money card: the title and its text, with the Backing sentence only while Backing is on. */
export const docsMoney = (raising: boolean): { title: string; text: string } =>
  raising ? { title: DOCS_MONEY.title, text: `${DOCS_MONEY.text} ${DOCS_MONEY.backing}` } : { title: DOCS_MONEY_OFF_TITLE, text: DOCS_MONEY.text };

export const DOCS_DESCRIPTION = 'How to add EarnKit to your agent, how the week works, the Shipping score, and every builder as JSON for selectors.';
