/**
 * Every string the site shows that is not data, and the pure formatters the cards use.
 * Plain words: no emoji, no em dash.
 */
import { categoryOf } from './program-file';
import { usdFull } from './programs-read';
import { quoteName } from './controls';
import { ART_CREDIT, CTA_INSTALL, FOOT_CTA, NAV_RECORD } from './footer-words';

/** The footer's words live in footer-words.ts (no imports), so the client error panel can carry the footer (v6.1.17). */
export { ART_CREDIT, CTA_INSTALL, FOOT_CTA, NAV_RECORD };

/** L23-11 (v6.1.16): the one date formatter in builder text, "Nov 6" in the current year and "Nov 6, 2025" in any other. */
export { dayWords } from './deadline';

/** L23-15 (v6.1.16): the line at the top of /docs#record after /me found the sign-in gone (`/docs?expired=1`). */
export const SIGN_IN_EXPIRED = 'Your sign-in expired. Ask your agent for a new link.';

/** The landing hero's figure, the one money that may round (lane 22, v6.1.15): down to one decimal in millions
 *  ("$3.1M" for 3,159,600), in full under a million ("$950,000"). Pure. */
export const heroUsdText = (usd: number): string =>
  usd >= 1_000_000 ? `$${Math.floor(usd / 100_000) / 10}M` : usdFull(Math.floor(usd));

/** The landing chip, "$3.1M in grants and prizes open now"; null at 0. */
export const heroChipText = (usd: number): string | null =>
  usd > 0 ? `${heroUsdText(usd)} in grants and prizes open now` : null;

/** The program's kind: `categoryOf` (one rule for the landing, /programs and replies, v6.1.14), a grant paid in
 *  USDC as "grant, in USDC". Pure. */
export function programKind(p: Partial<Parameters<typeof categoryOf>[0]> & { reward?: string }): string {
  const c = categoryOf({ ...p, investment: p.investment ?? false, in_person: p.in_person ?? false });
  return c === 'grant' && /\bUSDC\b/.test(p.reward ?? '') ? 'grant, in USDC' : c;
}

export const HERO_TITLE = 'Get funded for what you ship.';
/** The one line about EarnKit (L25-2, v6.1.16): the hero, the meta description, every share card and SchemaOrg. */
export const ONE_LINE = 'Your agent finds the grants and prizes your repo fits and fills the forms. Free.';
export const HERO_SUB = ONE_LINE;
/** The nav pill says the CTA's words: one install action (v6.1.15, #13). */
export const NAV_INSTALL = CTA_INSTALL;
/** Pages for everyone (L27-8, L27-16, L27-17, v6.1.16): the skip link first on every page, the signed-in nav link to
 *  /me, and the install pill's word under 360px (the header fits two rows at 320px). */
export const SKIP_LINK = 'Skip to content.';
export const NAV_INSTALL_SHORT = 'Add';
/** The one way the project-name limit is told on the pages (L27-31, v6.1.16): /me's hint and /docs' record card. */
export const PROJECT_NAME_LIMIT = 'Project names are at most 80 characters.';
/** One line each, no titles (v6.2.0). */
export const STEPS = ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?', 'Say yes. It fills the form and sends it, or hands you the draft to send.'];

/** Several of the six are rolling, so not "this week" (v6.1.14). */
export const EARN_TITLE = 'Open now';
/** The link under the landing's six to /programs, with no count (L25-15, v6.1.16). */
export const EARN_ALL = 'See all programs.';
export const EARN_EMPTY = 'Nothing is open right now.';
export const ROLLING = 'Rolling';
export const NOT_OPEN_YET = 'Not open yet';
export const CLOSED = 'Closed';
export const PROGRAMS_TITLE = 'Programs';
export const PROGRAMS_DESCRIPTION = 'Every grant, prize and investment EarnKit lists, with the money and the close date.';
/** A button that reads as a sentence (L21-21, v6.1.16). */
export const ALL_PROGRAMS = 'See all programs.';

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
export const NOT_FOUND_HOME = 'Go home.';
/** The site's title separator is `·` (L21-26, v6.1.16). */
export const NOT_FOUND_TITLE = 'Not found · EarnKit';
export const NOT_FOUND_METADATA = { title: NOT_FOUND_TITLE, robots: { index: false } };

export const DOCS_NAV: [string, string][] = [
  ['#install', 'Install'],
  ['#session', 'How a session goes'],
  ['#record', 'Your record'],
  ['#screening', 'Screening, for programs'],
  ['#programs', 'For program owners'],
  ['#checked', 'How programs are checked'],
  ['#terms', 'Terms'],
];
export const DOCS_DESCRIPTION = 'How to add EarnKit to your agent, how a session goes, your record, screening for programs, what program owners need to know, and how programs are checked.';
export const DOCS_INSTALL_TITLE = 'Add EarnKit to your agent';
/** The intro line above the install tabs already says it connects at once, so no step says it again (v6.1.8, Task 6). */
export const DOCS_STEPS = ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?'];
export const DOCS_SESSION = {
  title: 'How a session goes',
  // L25-9 (v6.1.16): who submits, in one sentence.
  text: 'Ask your agent: What can I earn? It drafts every fit with the facts from the repo. You say yes and it submits, or hands you the draft to send, and tracks the result.',
};
/** What an agent sends, and where saved answers wait (L25-8, v6.1.16): /docs, the Terms and llms.txt. */
export const APPROVAL_LINE = 'Your agent sends nothing you did not say yes to, and saved answers wait for your approval on your record page.';
/** How a program's reviewer gets access (L25-10, v6.1.16); the screen tool's non-reviewer replies say it too. */
// L38-23 (v6.1.18): who to message and where, never "the X link".
export const REVIEWER_ACCESS = 'Sign in once with GitHub and message EarnKit on X (link below) for reviewer access.';
export const DOCS_RECORD = {
  title: 'Your record',
  // L25-8 (v6.1.16): the approval sentence; the rest shortened so the docs stay under their word cap.
  text: `Sign in once with GitHub from your agent's link, and your agents share one record: facts, links, documents and answers. ${APPROVAL_LINE} Delete it any time.`,
};
export const DOCS_SCREEN = {
  title: 'Screening, for programs',
  // #15 (v6.1.15): each tier glossed in plain words.
  text: "Hand your applicant list to your agent and EarnKit sorts it by public evidence into five groups: used (people outside the team use it), live (a site that loads, or a contract in use), building (recent code), unverified (nothing public we could check) and flagged (looks copied, or most of its users are wallets the team funded itself). We read the repo, the chain and the site. We never show a builder's record, another program's name, screens or results, or another applicant's text. A program's reviewers share its screens, and they stay with the program when a reviewer leaves.",
};
/** L15-20 (v6.1.14): what a program owner needs before trusting a screen, one line each; v6.1.16: the second and third
 *  shortened, so /docs stays under its word cap with the other-agent line and the VS Code tab (L25-4). */
export const DOCS_PROGRAMS = {
  title: 'For program owners',
  items: [
    `${REVIEWER_ACCESS} Your team is marked the same way and shares your screens.`,
    "A screen reads only public evidence, never a builder's record or another applicant's text.",
    'Tell your agent who won; results reach builders only through the EarnKit id on their application, never through yours.',
    'Other programs never see your screens, results or decisions.',
    'Results come once a day, within 24 hours, and are kept 180 days with your decisions.',
  ],
} as const;
export const DOCS_CHECKED = {
  title: 'How programs are checked',
  // v6.1.15: never "owner" for EarnKit (concept picks). L25-12 (v6.1.16): no "weekly"; how long a dead page stays.
  text: 'EarnKit and a research bot check every program. Links are probed daily; a program whose page stays down leaves the list within about two weeks.',
};
export const DOCS_TERMS = { title: 'Terms', text: 'What EarnKit reads, stores and never does.', link: 'Read the terms' };

export const TERMS_TITLE = 'Terms';
export const TERMS_DESCRIPTION = 'What EarnKit reads, what it stores, and what it never does.';
export const TERMS_SECTIONS = [
  {
    title: 'What EarnKit reads',
    lines: [
      'Public repos, as anyone on GitHub can.',
      'For private repos, only what your agent reports to it.',
    ],
  },
  {
    title: 'What it stores',
    lines: [
      'An anonymous installation for each connected agent.',
      "The agent's name, your GitHub login once you sign in, and your address for at most two days to stop abuse.",
      'The applications you tell it about.',
      'Program data.',
    ],
  },
  {
    title: 'What it never does',
    lines: ['EarnKit never submits for you; your agent does, or you do. It never holds a wallet, sells data or emails builders.'],
  },
  {
    title: 'Your record',
    lines: [
      'Once you sign in with GitHub, EarnKit keeps one private record for you: the facts, links and answers you or your agent give it, your applications and your linked agents.',
      `Only you and your linked agents see it. ${APPROVAL_LINE}`,
      'You can edit or delete it any time on your record page.',
    ],
  },
  {
    title: 'Programs',
    lines: [
      'A program that screens its applicants sees only public evidence: the repo, the chain and the site.',
      "It never sees your record, the other programs you applied to, what another program decided or another applicant's text.",
    ],
  },
] as const;
/** Words in a terms line the page shows as a link: the record page is a place, not a path (v6.1.8, lane 5). */
export const TERMS_LINKS: [string, string][] = [['your record page', '/me']];

export const ME_TITLE = 'Your record';
export const ME_DESCRIPTION = 'Your facts, links, documents and answers, kept once for every agent of yours.';
export const ME_SIGNED_IN = (login: string): string => `Signed in as ${login}.`;
export const ME_SIGN_OUT = 'Sign out';
export const ME_SAVE = 'Save';
/** L35-24 (v6.1.17 Task 4): a collapsed answer's link that opens it on the page, the only one open. */
export const ME_ANSWER_OPEN = 'Open this answer';
export const ME_APPROVE = 'Approve';
export const ME_UNAPPROVE = 'Unapprove';
export const ME_APPROVED = (day: string): string => `Approved ${day}.`;
export const ME_BY_AGENT = 'From your agent';
export const ME_PENDING_TITLE = 'Waiting for you';
export const ME_PENDING_LINE = 'Read these, then approve each: an unapproved answer is never sent.';
/**
 * L35-24 (v6.1.17 Task 4): Waiting for you counts the answers instead of repeating them; each waits collapsed in its
 * section with this mark, and opens with its Approve.
 */
export const ME_PENDING_ANSWERS = (n: number) => (n === 1 ? '1 answer waits for you below.' : `${n} answers wait for you below.`);
export const ME_PENDING_FIRST = 'Open the first one';
export const ME_WAITING = 'Waiting for you.';
export const ME_NO_PROJECTS = 'No projects yet. Your agent adds them as you work.';
/** A project the applications name that the record does not hold (L21-12, v6.1.16): read-only, by its repo link or name. */
export const ME_PROJECT_SEEN = (label: string, n: number): string => `${label}: ${n} ${n === 1 ? 'application' : 'applications'}.`;
export const ME_POLICY_LINE = 'Your agent applies on its own only when this is on, within these limits.';
/** Under an answer: the short form the agent cut from it, which approving the answer approves too (v6.1.8 B16). */
export const ME_SHORT_LABEL = 'Short form, for fields under 300 characters.';
/** The team list under About you (v6.1.8 B19): one name and one role per member, and a row to add one. */
export const ME_TEAM = {
  name: (n: number) => `Member ${n}`,
  role: (n: number) => `Member ${n} role`,
  add: 'Add a member',
  hint: 'Clear the name to remove them.',
} as const;
/** Standing approval on with no category ticked (v6.1.8 C43). */
export const ME_PICK_CATEGORY = 'Pick at least one category.';
/** L24-15 (v6.1.16 Task 11): standing approval on with Press submit off would only ever draft; refused, nothing saved. */
export const ME_PRESS_SUBMIT_FIRST = 'Turn on Press submit for me first.';
/**
 * L24-14 (v6.1.16 Task 11): the standing approval's state in words, above its form: "On: up to 1 a day, grants and
 * hackathons, up to $4,500." or "Off.", then "Sent under it: {n}." Day-based (Task 9 review N1): the agent applies when
 * it next checks, never at night. `cap` is the money text, null with no cap. Pure.
 */
export function mePolicyStatus(p: { on: boolean; perDay: number; kinds: string[]; cap: string | null } = { on: false, perDay: 1, kinds: [], cap: null }, sent = 0): string[] {
  const kinds = p.kinds.length <= 1 ? (p.kinds[0] ?? '') : `${p.kinds.slice(0, -1).join(', ')} and ${p.kinds.at(-1)}`;
  const on = `On: up to ${p.perDay} a day${kinds ? `, ${kinds}` : ''}${p.cap ? `, up to ${p.cap}` : ''}.`;
  return [p.on ? on : 'Off.', `Sent under it: ${sent}.`];
}
export const ME_LEDGER_TITLE = 'Your applications';
export const ME_LEDGER_EMPTY = 'Nothing tracked yet.';
export const ME_AGENTS_TITLE = 'Your agents';
export const ME_AGENTS_EMPTY = 'No agents linked.';
/** An agent with no name, by the day it was linked (L21-10, v6.1.16); never its client id. */
export const ME_AN_AGENT = (day: string | null): string => (day ? `An agent linked ${day}` : 'An agent');
/** One line per program the builder reviews (L21-13, v6.1.16). */
export const ME_REVIEWS = (program: string): string => `You review ${program}. Results come through your agent.`;
/** After an unlink (L21-7) and for an agent that is not the builder's (L21-15, v6.1.16). */
export const ME_UNLINKED = (agent: string): string => `Unlinked ${agent}.`;
export const ME_UNLINK_NOT_YOURS = 'That agent is not on your account.';
/** After a save, beside the control (L21-11, v6.1.16). */
export const ME_SAVED = 'Saved.';
export const ME_LINKED = (day: string): string => `Linked ${day}.`;
export const ME_UNLINK = 'Unlink';
/** The banner above the record after sign-in from /link/<code>: the link happens only on Link this agent. */
export const ME_LINK_TITLE = 'Link an agent to this account?';
/** The link banner in three parts: the words before the agent's own name, the name (shown isolated, it is the agent's text) and the rest. */
export const ME_LINK_PARTS = (agent: string | null, day: string): [string, string, string] => {
  const rest = `, first seen ${day}, asked for this link. If you did not ask your agent for this just now, choose This is not me.`;
  // Task 11 fix round 1 (N3): the agent's own name through quoteName, as the /link page shows it.
  return agent ? ['The agent calling itself ', quoteName(agent), rest] : ['Your agent', '', rest];
};
export const ME_LINK_LINE = (agent: string | null, day: string): string => ME_LINK_PARTS(agent, day).join('');
/** After POST /me/link (v6.1.7 C2). */
export const ME_LINK_DONE = (agent: string | null): string => `Linked: ${agent ? quoteName(agent) : 'your agent'}.`;
export const ME_LINK_NOT = 'Not linked.';
/** The banner's title for a code this builder used (L21-6, v6.1.16). */
export const ME_LINK_USED = 'Linked.';
/** The banner's title for an expired code (L21-6, L21-17). */
export const ME_LINK_EXPIRED_TITLE = 'This link has expired.';
/** A code EarnKit never made, or not code-shaped (L21-17, v6.1.16). */
export const UNKNOWN_CODE = 'This link is not one of ours.';
export const ME_LINK_YES = 'Link this agent';
export const ME_LINK_NO = 'This is not me.';
export const ME_DELETE_TITLE = 'Delete your record';
export const ME_DELETE_LINE = 'Deleting your account unlinks your agents, ends your reviewer access and removes your applications. Programs keep what they already screened.';
/** On the home page after a delete (L21-9; L27-11, v6.1.16: "record", the page's own word). */
export const ME_DELETED_LINE = 'Your record is deleted.';
export const ME_DELETE_HINT = 'Type your GitHub login to confirm.';
export const ME_DELETE = 'Delete everything';
export const ME_NOT_SET = 'Not set';
export const ME_YES = 'Yes';
export const ME_NO = 'No';
export const ME_BLOCKS = {
  person: 'About you',
  team: 'Your team',
  projects: 'Your projects',
  company: 'The company',
  docs: 'Your documents',
  traction: 'Traction',
  answers: 'Your answers',
  policy: 'Standing approval',
} as const;
export const ME_LABELS = {
  'person.name': 'Name', 'person.email': 'Email', 'person.x': 'X handle', 'person.linkedin': 'LinkedIn', 'person.location': 'Location',
  'person.timezone': 'Time zone', 'person.phone': 'Phone', 'person.bio': 'Short bio', 'person.technical': 'Technical founder', 'person.based_country': 'Country',
  'project.name': 'Name', 'project.one_liner': 'One line', 'project.description': 'Description', 'project.goals': 'Goals', 'project.repo_url': 'Repo link',
  'project.live_url': 'Live link', 'project.demo_url': 'Demo link', 'project.category': 'Category', 'project.chains_claimed': 'Chains',
  'company.name': 'Name', 'company.incorporated': 'Incorporated', 'company.jurisdiction': 'Jurisdiction', 'company.raised_usd': 'Raised (USD)',
  'company.raised_from': 'Raised from', 'company.stage': 'Stage', 'company.launch_date': 'Launch date',
  'docs.resume_url': 'Resume link', 'docs.deck_url': 'Deck link', 'docs.founder_video_url': 'Founder video link', 'docs.demo_video_url': 'Demo video link',
  'docs.other': 'Other links',
  'traction.line_pre_launch': 'Your one line on traction', 'traction.waitlist': 'Waitlist', 'traction.revenue_usd_claim': 'Revenue claim (USD)',
  'traction.notes': 'Notes',
  // v6.1.16 Task 11 (L24-12, Task 9 review N1): the agent applies when it next checks, so the limit is a day's, never a
  // night's; an award above the cap is asked about, never skipped.
  'policy.auto_apply': 'Apply without asking, within these limits', 'policy.max_per_night': 'Most a day', 'policy.categories': 'Categories',
  'policy.max_ask_usd': 'Ask me first above (USD)', 'policy.never': 'Programs to skip', 'policy.agent_may_submit': 'Press submit for me when I say yes.',
  'company.raised': 'Money raised',
} as const;
/** The words for a stored choice: company stages and program categories. */
export const ME_CHOICES: Record<string, string> = {
  idea: 'Idea', building: 'Building', pre_launch: 'Pre-launch', launched: 'Launched',
  grant: 'Grants', hackathon: 'Hackathons', investment: 'Investment', bounty: 'Bounties',
};
export const ME_STATUS: Record<string, string> = {
  started: 'Started', applied: 'Applied',
  // L24-4 (v6.1.16 Task 11): a claim the builder held; nothing goes until they say go.
  held: 'Held', won: 'Won', rejected: 'Rejected', no_result: 'No result', skipped: 'Skipped',
  // L23-7 (v6.1.16): a claim past its 24 hours with no send.
  started_not_sent: 'Started, not sent',
};
export const ME_HINTS = { 'docs.other': 'One per line: a label, then the link.', 'policy.never': 'One program per line, by its title (for example Base Builder Grants).', 'project.chains_claimed': 'Comma separated.', 'project.name': PROJECT_NAME_LIMIT } as const;
export const ME_ERRORS = {
  signin: 'Sign in again from the link your agent gives you.',
  expired: 'This page expired. Reload it and try again.',
  /** L31-3 (v6.1.16 Task 17): a /me post with no same-origin Origin or Referer. */
  notFromUs: 'That form did not come from EarnKit.',
  form: 'Send this as a web form.',
  large: 'That is too long to save.',
  slow: 'The request took too long. Try again.',
  field: 'That cannot be changed here.',
  confirm: 'Type your GitHub login to delete.',
  broken: 'Your record could not be read, so nothing was saved. Try again later.',
  changed: 'This text changed since you opened the page. Read it again.',
  yesNo: 'choose yes or no.',
  /** One expired wording everywhere (L21-17, v6.1.16): link-routes' EXPIRED is this line. */
  linkExpired: 'This link has expired. Ask your agent for a new one.',
} as const;
/** What a value must be, in plain words, after "<label>: " (v6.1.7 C4). */
const amount = (n: number) => n.toLocaleString('en-US');
export const ME_VALUE_WORDS = {
  under: (n: number) => `at most ${amount(n)} characters`,
  atMost: (n: number) => `at most ${amount(n)}`,
  option: 'pick one of the options',
  https: 'a link starting with https://',
  email: 'an email address',
  range: (a: number | null, b: number | null, whole: boolean) => {
    const what = whole ? 'a whole number' : 'a number';
    if (a !== null && b !== null) return `${what} from ${amount(a)} to ${amount(b)}`;
    if (a !== null) return `${what} of ${amount(a)} or more`;
    if (b !== null) return `${what} up to ${amount(b)}`;
    return what;
  },
} as const;
