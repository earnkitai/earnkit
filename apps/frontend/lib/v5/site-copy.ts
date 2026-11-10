/**
 * Every string the site shows that is not data, and the pure formatters the cards use.
 * Plain words: no emoji, no em dash. The terms page alone may say "launch a token".
 */
import { compactUsd } from './programs-read';

export { compactUsd };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 4" (UTC). */
export const monthDay = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

/** The landing chip, "$105K in grants and prizes open now"; null at 0. */
export const heroChipText = (usd: number): string | null =>
  usd > 0 ? `${compactUsd(usd)} in grants and prizes open now` : null;

/** The file's category, else "grant", "grant, in USDC", "hackathon" or "investment". Pure. */
export function programKind(c: { category?: string; investment?: boolean; in_person?: boolean; reward?: string }): string {
  const usdc = /\bUSDC\b/.test(c.reward ?? '');
  // v6.1.14: the file's own category wins over the reward words ("$100K in prizes" on a mentorship cohort).
  if (c.category) return c.category === 'grant' && usdc ? 'grant, in USDC' : c.category;
  if (c.investment) return 'investment';
  if (c.in_person === true || /\bprizes?\b/i.test(c.reward ?? '')) return 'hackathon';
  return usdc ? 'grant, in USDC' : 'grant';
}

export const HERO_TITLE = 'Get funded for what you ship.';
export const HERO_SUB = 'Your agent finds the grants and prizes you fit and fills the forms. Free.';
export const CTA_INSTALL = 'Add EarnKit to your agent';
export const NAV_INSTALL = 'Add to your agent';
/** One line each, no titles (v6.2.0). */
export const STEPS = ['Add EarnKit to your agent.', 'Ask what this repo can earn.', 'Say yes. It fills the form and sends it, or hands you the draft to send.'];

/** Several of the six are rolling, so not "this week" (v6.1.14). */
export const EARN_TITLE = 'Open now';
/** The link under the landing's six to /programs. */
export const EARN_ALL = (n: number): string => `See all ${n} programs`;
export const EARN_EMPTY = 'Nothing is open right now.';
export const ROLLING = 'Rolling';
export const NOT_OPEN_YET = 'Not open yet';
export const CLOSED = 'Closed';
export const PROGRAMS_TITLE = 'Programs';
export const PROGRAMS_DESCRIPTION = 'Every grant, hackathon and investment EarnKit lists, with the money and the close date.';
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
  ['#record', 'Your record'],
  ['#screening', 'Screening, for programs'],
  ['#checked', 'How programs are checked'],
  ['#terms', 'Terms'],
];
export const DOCS_DESCRIPTION = 'How to add EarnKit to your agent, how a session goes, your record, screening for programs, and how programs are checked.';
export const DOCS_INSTALL_TITLE = 'Add EarnKit to your agent';
/** The intro line above the install tabs already says it connects at once, so no step says it again (v6.1.8, Task 6). */
export const DOCS_STEPS = ['Add EarnKit', 'Ask what this repo can earn.'];
export const DOCS_SESSION = {
  title: 'How a session goes',
  text: 'Your agent asks what the repo can earn. It drafts every fit with the facts from the repo. You say yes and it submits in its own browser and tracks the result.',
};
export const DOCS_RECORD = {
  title: 'Your record',
  text: 'Sign in once with GitHub and your agents share one record: your facts, links, documents and the answers you approved. Once you are signed in, nothing is sent that you did not approve. Delete it any time. Ask your agent for your sign-in link.',
};
export const DOCS_SCREEN = {
  title: 'Screening, for programs',
  text: "Hand your applicant list to your agent and EarnKit returns it in five tiers with public evidence: used, live, building, unverified, flagged. We read the repo, the chain and the site. We never show a builder's record, another program's name or another applicant's text.",
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
      'Public repos, as anyone on GitHub can.',
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
  {
    title: 'Your record',
    lines: [
      'Once you sign in with GitHub, EarnKit keeps one private record for you: the facts, links and answers you or your agent give it, your applications and your linked agents.',
      'Only you and your linked agents see it. Nothing your agent wrote is sent until you approve it.',
      'You can edit or delete it any time on your record page.',
    ],
  },
  {
    title: 'Programs',
    lines: [
      'A program that screens its applicants sees only public evidence: the repo, the chain and the site.',
      "It never sees your record, the other programs you applied to or another applicant's text.",
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
export const ME_APPROVE = 'Approve';
export const ME_UNAPPROVE = 'Unapprove';
export const ME_APPROVED = (day: string): string => `Approved ${day}.`;
export const ME_BY_AGENT = 'From your agent';
export const ME_PENDING_TITLE = 'Waiting for you';
export const ME_PENDING_LINE = 'Read these, then approve each: an unapproved answer is never sent.';
export const ME_NO_PROJECTS = 'No projects yet. Your agent adds them as you work.';
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
export const ME_LEDGER_TITLE = 'Your applications';
export const ME_LEDGER_EMPTY = 'Nothing tracked yet.';
export const ME_AGENTS_TITLE = 'Your agents';
export const ME_AGENTS_EMPTY = 'No agents linked.';
export const ME_AN_AGENT = 'An agent';
export const ME_LINKED = (day: string): string => `Linked ${day}.`;
export const ME_UNLINK = 'Unlink';
/** The banner above the record after sign-in from /link/<code>: the link happens only on Link this agent. */
export const ME_LINK_TITLE = 'Link an agent to this account?';
/** The link banner in three parts: the words before the agent's own name, the name (shown isolated, it is the agent's text) and the rest. */
export const ME_LINK_PARTS = (agent: string | null, day: string): [string, string, string] => {
  const rest = `, first seen ${day}, asked for this link. If you did not ask your agent for this just now, choose Not me.`;
  return agent ? ['The agent calling itself ', agent, rest] : ['Your agent', '', rest];
};
export const ME_LINK_LINE = (agent: string | null, day: string): string => ME_LINK_PARTS(agent, day).join('');
/** After POST /me/link (v6.1.7 C2). */
export const ME_LINK_DONE = (agent: string | null): string => `Linked: ${agent ?? 'your agent'}.`;
export const ME_LINK_NOT = 'Not linked.';
export const ME_LINK_YES = 'Link this agent';
export const ME_LINK_NO = 'Not me';
export const ME_DELETE_TITLE = 'Delete your record';
export const ME_DELETE_LINE = 'This removes your record, your applications and your sign-ins. Your agents keep working, unsigned.';
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
  'policy.auto_apply': 'Apply overnight without asking, within these limits', 'policy.max_per_night': 'Most per night', 'policy.categories': 'Categories',
  'policy.max_ask_usd': 'Skip awards above (USD)', 'policy.never': 'Programs to skip', 'policy.agent_may_submit': 'Press submit for me',
  'company.raised': 'Money raised',
} as const;
/** The words for a stored choice: company stages and program categories. */
export const ME_CHOICES: Record<string, string> = {
  idea: 'Idea', building: 'Building', pre_launch: 'Pre-launch', launched: 'Launched',
  grant: 'Grants', hackathon: 'Hackathons', investment: 'Investment', bounty: 'Bounties',
};
export const ME_STATUS: Record<string, string> = {
  started: 'Started', applied: 'Applied', won: 'Won', rejected: 'Rejected', no_result: 'No result', skipped: 'Skipped',
};
export const ME_HINTS = { 'docs.other': 'One per line: a label, then the link.', 'policy.never': 'One program per line, by its title (for example Base Builder Grants).', 'project.chains_claimed': 'Comma separated.' } as const;
export const ME_ERRORS = {
  signin: 'Sign in again from the link your agent gives you.',
  expired: 'This page expired. Reload it and try again.',
  form: 'Send this as a web form.',
  large: 'That is too long to save.',
  field: 'That cannot be changed here.',
  confirm: 'Type your GitHub login exactly to delete.',
  broken: 'Your record could not be read, so nothing was saved. Try again later.',
  changed: 'This text changed since you opened the page. Read it again.',
  yesNo: 'choose yes or no.',
  linkExpired: 'That link expired. Ask your agent for a new one.',
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
