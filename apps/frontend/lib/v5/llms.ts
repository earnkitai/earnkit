/** The text at /llms.txt: what EarnKit is and how an agent or a researcher uses it. */
import { AGENTS, MCP_URL, type Agent } from './agents';
import { FIND_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION, TRACK_DESCRIPTION } from './tool-text';
import { APPROVAL_LINE } from './site-copy';

/** llms.txt's first session step (L25-7, v6.1.16): find first, record once signed in. */
export const LLMS_SESSION_FIRST = 'The agent calls find with the project it is in; once signed in, record with get.';

/** One agent's way in: its commands and the steps after them when it has commands, its message, else its steps. */
function connectLines(a: Agent): string {
  const text = a.code
    ? [a.code, a.after, a.afterCode, a.last].filter(Boolean).join('\n')
    : a.message ?? a.steps.join(' ');
  return text.includes('\n') ? `- ${a.name}:\n${text.split('\n').map((l) => `    ${l}`).join('\n')}` : `- ${a.name}: ${text}`;
}

export const LLMS_TEXT = `# EarnKit

EarnKit finds the grants, hackathons and investments a builder's repo fits, pre-fills every
application from the repo, and tracks the result. It runs inside the builder's own agent.
Free. Nothing to sign up for.

## Connect

EarnKit is an MCP server: ${MCP_URL}

Clients connect with standard MCP OAuth. Each connected agent is one anonymous installation until
the builder signs in once.

${AGENTS.map(connectLines).join('\n')}
- Any other MCP client: add ${MCP_URL} as a remote server

Every agent's steps: https://earnkit.com/docs#install

Then ask your agent: "What can I earn?"

## How a session goes

1. ${LLMS_SESSION_FIRST} EarnKit reads the public repo; for a private repo it uses what the agent reports.
2. The reply lists every program the repo fits, money first, with the application pre-filled from
   the record and the repo, and what is one change away.
3. The builder says yes. The agent calls track with started, drafts and submits in its own browser,
   then calls track with applied. EarnKit never submits.
4. The agent calls track with the result, won or rejected. Once results are due, EarnKit asks how it went until one is recorded.

## The four tools

- find: ${FIND_DESCRIPTION}
- track: ${TRACK_DESCRIPTION}
- record: ${RECORD_DESCRIPTION}
- screen: ${SCREEN_DESCRIPTION}

## The record

The first find gives a one-time sign-in link, earnkit.com/link/<code>. The builder signs in once
with GitHub, and from then on every agent of theirs shares one record and one ledger.
${APPROVAL_LINE} The record page is https://earnkit.com/me, where the builder can also edit or delete
everything. Unlinked agents keep working with no sign-in.

## Screening

A program's reviewer is marked by EarnKit.
Their agent calls screen with the applicant list, as its description above says. Each comes back used, live, building, unverified or flagged, with the public
evidence behind it: the repo, the chain and the site, 25 applicants a page. A reviewer never sees a
builder's record, another program's name, screens or results, or another applicant's text. A
program's reviewers share its screens and results, which stay with the program when a reviewer
leaves. A reviewer never posts the result of their own application. Results come once a day, within
24 hours, and are kept 180 days with the program's decisions.

## Program pages

Every listed program has a public guide at https://earnkit.com/programs/<id>: the money, when it
closes, who can apply, what the form asks, the rules and the sources. The list is at
https://earnkit.com/programs.

## For researchers

The programs API is public and read only: https://earnkit.com/api/programs
(?category=grant|hackathon|investment|bounty, ?status=active|upcoming).
Counts only: https://earnkit.com/api/stats

## What EarnKit does not do

It does not submit applications, hold a wallet, sell data or email builders. Rewards come from
each program's organizer. Terms: https://earnkit.com/terms
`;
