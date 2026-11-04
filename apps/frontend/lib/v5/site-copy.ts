/**
 * Every string the site shows that is not data, and the pure formatters the cards use.
 * Plain words: no emoji, no em dash. The terms page alone may say "launch a token".
 */
import { compactUsd } from './programs-read';

export { compactUsd };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 4" (UTC). */
export const monthDay = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

/** The landing chip, "$105K in grants open now"; null at 0. */
export const heroChipText = (usd: number): string | null => (usd > 0 ? `${compactUsd(usd)} in grants open now` : null);

/** "grant", "grant, in USDC", "hackathon" or "investment". Pure. */
export function programKind(c: { investment?: boolean; in_person?: boolean; reward?: string }): string {
  if (c.investment) return 'investment';
  if (c.in_person === true || /\bprizes?\b/i.test(c.reward ?? '')) return 'hackathon';
  return /\bUSDC\b/.test(c.reward ?? '') ? 'grant, in USDC' : 'grant';
}

export const HERO_TITLE = 'Get funded for what you ship.';
export const HERO_SUB = 'Your agent finds the programs your repo fits and drafts every application. Free.';
export const CTA_INSTALL = 'Add EarnKit to your agent';
export const NAV_INSTALL = 'Add to your agent';
export const STEPS_TITLE = 'How it works';
export const STEPS = [
  ['Connect', 'Add EarnKit to the agent you already use. Nothing to sign up for.'],
  ['Ask', 'Your agent asks what this repo can earn and gets every fit, pre-filled.'],
  ['Say yes', 'Your agent submits in its own browser and tracks the result.'],
] as const;

export const EARN_TITLE = 'Open programs';
export const EARN_EMPTY = 'Nothing is open right now.';
export const ROLLING = 'Rolling, apply anytime';
export const NOT_OPEN_YET = 'Not open yet';
export const CLOSED = 'Closed';
export const PROGRAMS_TITLE = 'Programs';
export const PROGRAMS_DESCRIPTION = 'Every grant, hackathon and bounty EarnKit lists, with the money and the close date.';
export const ALL_PROGRAMS = 'All programs';
export const FOOT_CTA = 'Ask your agent what you can earn.';
export const ART_CREDIT = 'Art: C.W. Eckersberg, 1815 · G.P. Panini, c. 1734';

export const GUIDE_FIELDS_TITLE = 'What the form asks';
export const GUIDE_RULES_TITLE = 'Rules';
export const GUIDE_ELIGIBILITY_TITLE = 'Who can apply';
export const GUIDE_FOCUS_TITLE = 'What they want now';
export const GUIDE_ROUNDS_TITLE = 'Past rounds';
export const GUIDE_BEST_BET_TITLE = 'Best bet';
export const GUIDE_SOURCES_TITLE = 'Sources';
export const GUIDE_NO_ELIGIBILITY = 'No special requirements are listed.';
export const GUIDE_ASK = (title: string): string => `What can I earn on ${title}?`;

export const NOT_FOUND_BIG = '404';
export const NOT_FOUND_TEXT = 'Nothing shipped here.';
export const NOT_FOUND_HOME = 'Back home';
export const NOT_FOUND_TITLE = 'Not found | EarnKit';
export const NOT_FOUND_METADATA = { title: NOT_FOUND_TITLE, robots: { index: false } };

export const DOCS_NAV: [string, string][] = [
  ['#install', 'Install'],
  ['#session', 'How a session goes'],
  ['#checked', 'How programs are checked'],
  ['#terms', 'Terms'],
];
export const DOCS_DESCRIPTION = 'How to add EarnKit to your agent, how a session goes, and how programs are checked.';
export const DOCS_INSTALL_TITLE = 'Add EarnKit to your agent';
export const DOCS_STEPS = ['Add the server', 'Sign in', 'Ask: what can I earn?'];
export const DOCS_SESSION = {
  title: 'How a session goes',
  text: 'Your agent asks what the repo can earn. It drafts every fit with the facts from the repo. You say yes and it submits in its own browser and tracks the result.',
};
export const DOCS_CHECKED = {
  title: 'How programs are checked',
  text: 'The owner and a research bot curate the list. Every program is re-checked weekly and its links are probed daily. Stale programs drop off.',
};
export const DOCS_TERMS = { title: 'Terms', text: 'What EarnKit reads, stores and never does.', link: 'Read the terms' };

export const TERMS_TITLE = 'Terms';
export const TERMS_DESCRIPTION = 'What EarnKit reads, what it stores, and what it never does.';
export const TERMS_SECTIONS = [
  {
    title: 'What EarnKit reads',
    lines: [
      'Public repos, with its own GitHub access.',
      'For private repos, only what your agent reports to it.',
    ],
  },
  {
    title: 'What it stores',
    lines: [
      'An anonymous installation for each connected agent.',
      'The applications you tell it about.',
      'Program data.',
    ],
  },
  {
    title: 'What it never does',
    lines: ['EarnKit will never submit for you, hold a wallet, launch a token, sell data or email builders.'],
  },
] as const;
