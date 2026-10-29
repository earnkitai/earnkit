import { LIVE_BONUS, SHIPPING_WEEKS } from './score-v2';

/**
 * v3.1 site Task 10 (Docs board): every string on /docs. The agents' install steps and commands are not here: the
 * install card reads them from AGENTS (app/components/sections/agents.tsx), so the sheet and the page never differ.
 * Pinned by v31-site-docs.test.ts and v3-docs.test.ts: under 250 words on the page, no em dash, no emoji, no points.
 */
export const DOCS_NAV: [string, string][] = [
  ['#install', 'Install'],
  ['#week', 'How the week works'],
  ['#score', 'Shipping score'],
  ['#money', 'Programs'],
  ['#selectors', 'For selectors'],
];

export const DOCS_INSTALL_TITLE = 'Add EarnKit to your agent';
export const DOCS_STEPS = ['Add the server', 'Sign in with X', 'Ask: what can I earn?'];

/**
 * Install fixes (owner 2026-10-22): the "No GitHub yet?" help under the install steps. Only the steps
 * docs/design-docs-and-implementation-plans/v3.1-install-research.md marks confirmed (Lovable, Bolt); no Replit steps
 * (unconfirmed). The v0 line is true because EarnKit reads the default branch's commits (person-github.ts
 * defaultBranchRef history; the REST /commits reads name no branch, so GitHub answers with the default one).
 */
export const DOCS_GITHUB = {
  title: 'No GitHub yet?',
  text: 'EarnKit reads your commits on GitHub. Connect your app builder once:',
  tools: [
    ['Lovable', 'Project settings, then Git, then GitHub. Choose "Add connection", pick your account on GitHub, "Install & Authorize", then "Connect".'],
    ['Bolt', 'The GitHub icon top right: "Log in to GitHub", "Authorize", then "Install the GitHub App", "Install & Authorize". Click the GitHub icon again, name the repo, "Create repository".'],
  ] as [string, string][],
  v0: 'v0 saves changes to a working branch until you Publish. Publish so your work reaches main.',
};

export const DOCS_WEEK = {
  title: 'How the week works',
  text: 'Ship during the week. Monday, EarnKit writes your update from the commits and emails it. One tap posts it.',
};
/** The real scoring (score-v2.ts): weeks with code over the last SHIPPING_WEEKS, plus LIVE_BONUS for a live product. */
export const DOCS_SCORE = {
  title: 'Shipping score',
  text: `0 to 100 over ${SHIPPING_WEEKS} weeks. Weeks with real code count, not commit volume. A live product adds ${LIVE_BONUS}.`,
};
export const DOCS_MONEY = {
  title: 'Programs',
  text: 'Your agent drafts applications from your Activity.',
};

export const DOCS_SELECTORS = {
  title: 'For selectors',
  text: "Every builder's standing as JSON.",
  url: 'earnkit.com/api/builders/<handle>.json',
};

export const DOCS_DESCRIPTION = 'How to add EarnKit to your agent, how the week works, the Shipping score, and every builder as JSON for selectors.';
