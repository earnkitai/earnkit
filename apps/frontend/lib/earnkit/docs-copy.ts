/**
 * v3 Stage 3, Task 5 (spec 5.6): every string on /docs. The agents' install steps are not here: the page
 * reads them from AGENTS in app/components/sections/AddToAgent.tsx, so the modal and the page never differ.
 * Pinned by v3-docs.test.ts: under 600 words in all, no em dash, no emoji.
 */
export const DOCS_TITLE = 'Docs';
export const DOCS_LEDE = 'EarnKit is one link your agent connects to. It reads your commits, finds programs that fit and drafts your applications.';

export const DOCS_INSTALL_TITLE = 'Add EarnKit to your agent';
export const DOCS_INSTALL_SUB = 'Free. Sign in with X once. Then ask your agent: "What can I earn?"';

export const DOCS_DO_TITLE = 'What your agent can do';
export const DOCS_DO_SUB = 'Five tools: find, prepare, confirm, tell, score.';
export const DOCS_DO: { label: string; text: string }[] = [
  { label: 'Where you stand', text: 'Your three numbers, any time you ask.' },
  { label: 'Your ship log', text: 'Written from your commits. You never type it.' },
  { label: 'Programs that fit', text: 'The open ones that match what you build, and a drafted application for each.' },
  { label: 'Backing', text: 'Offered once, after your first confirmed week. It never changes your rank.' },
  { label: 'Points', text: 'Every confirmed week earns points. Points convert to $EARN in proportion.' },
];

export const DOCS_NUMBERS_TITLE = 'The three numbers';
export const DOCS_NUMBERS: { label: string; text: string }[] = [
  { label: 'Shipping', text: 'How much you shipped, counted from your commits.' },
  { label: 'Rank', text: 'Where that puts you among builders.' },
  { label: 'Earned', text: 'Money that reached you through EarnKit: backing fees paid and program prizes.' },
];
export const DOCS_ORIGINALITY = 'Originality is a check that the work is yours.';

export const DOCS_WEEK_TITLE = 'How the week works';
export const DOCS_WEEK: { label: string; text: string }[] = [
  { label: 'Monday', text: 'EarnKit writes your week and emails you the draft.' },
  { label: 'Looks right or Hide', text: 'Looks right puts it on your page. Hide keeps it off.' },
  { label: 'Your note', text: 'One line in your words. It shows as a quote.' },
  { label: 'The share link', text: 'One link posts the week to X.' },
];

export const DOCS_SELECTORS_TITLE = 'For program selectors';
export const DOCS_SELECTORS_SUB = 'A builder page proves what shipped: commits, weeks and money that reached you, each linked to its source.';
export const DOCS_SELECTORS: { label: string; text: string }[] = [
  { label: 'The page', text: 'earnkit.com/<handle>' },
  { label: 'The JSON', text: '/api/builders/<handle>.json' },
  { label: 'The badge', text: '/badge/<handle>.svg' },
];
export const DOCS_CONTACT_LEAD = 'To list a program or ask a question:';
export const DOCS_CONTACT = 'j@earnkit.com';

export const DOCS_TERMS_TITLE = 'Terms';
export const DOCS_TERMS_LINK = 'Read the terms';

export const DOCS_DESCRIPTION = 'How to add EarnKit to your agent, what it does, the three numbers, the week, and what a builder page proves.';
