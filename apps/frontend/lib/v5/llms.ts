/** The text at /llms.txt: what EarnKit is and how an agent or a researcher uses it. */
import { AGENTS, MCP_URL, type Agent } from '../../app/components/sections/agents';

/** One agent's way in: its commands or message when it has them, else its steps. */
function connectLines(a: Agent): string {
  const body = a.code
    ? [a.code, a.afterCode].filter(Boolean).join('\n')
    : a.message ?? a.steps.join(' ');
  const text = body;
  return text.includes('\n') ? `- ${a.name}:\n${text.split('\n').map((l) => `    ${l}`).join('\n')}` : `- ${a.name}: ${text}`;
}

export const LLMS_TEXT = `# EarnKit

EarnKit finds the grants, hackathons and bounties a builder's repo fits, pre-fills every
application from the repo, and tracks the result. It runs inside the builder's own agent.
Free. Nothing to sign up for.

## Connect

EarnKit is an MCP server: ${MCP_URL}

Clients connect with standard MCP OAuth. Each connected agent is one anonymous installation.

${AGENTS.map(connectLines).join('\n')}
- Any other MCP client: add ${MCP_URL} as a remote server

Every agent's steps: https://earnkit.com/docs#install

Then ask your agent: "What can I earn?"

## How a session goes

1. The agent calls find with the project it is in. EarnKit reads the public repo; for a private
   repo it uses what the agent reports.
2. The reply lists every program the repo fits, money first, with the application pre-filled, and
   what is one change away.
3. The builder says yes. The agent drafts and submits in its own browser. EarnKit never submits.
4. The agent calls track with the result, applied, won or rejected. EarnKit asks once how it went.

## The two tools

- find: what the project can earn now, what is one change away, what moved since the last find,
  and the ledger. With program_id: one program's details and guide.
- track: records what happened to an application (applied, won, rejected, no result, skipped) or
  a change the builder made.

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
