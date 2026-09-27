#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = (process.env.EARNKIT_URL ?? 'https://earnkit.com').replace(/\/$/, '');
const TOKEN_FILE = join(process.env.EARNKIT_HOME ?? join(homedir(), '.earnkit'), 'token');

/** Anonymous installation token: created on first use, kept on this machine. */
async function token() {
  const saved = await readFile(TOKEN_FILE, 'utf8').catch(() => '');
  if (saved.trim()) return saved.trim();

  const res = await fetch(`${API}/api/installations`, { method: 'POST' });
  if (!res.ok) throw new Error(`Could not connect to EarnKit (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  await mkdir(join(TOKEN_FILE, '..'), { recursive: true });
  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

async function call(tool: string, input: unknown = {}) {
  try {
    const res = await fetch(`${API}/api/agent/${tool}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    return { content: [{ type: 'text' as const, text }], isError: !res.ok };
  } catch (err) {
    return { content: [{ type: 'text' as const, text: String(err) }], isError: true };
  }
}

const project = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    repo_url: z.string().optional(),
    live_url: z.string().optional(),
    demo_url: z.string().optional(),
    token_url: z.string().optional(),
  })
  .describe('What you know about the project so far.');

const server = new McpServer(
  { name: 'earnkit', version: '0.1.0' },
  {
    instructions:
      'EarnKit: where agents earn. It lists live builder programs with rewards. ' +
      'Flow: list_programs -> builder picks one -> get_program -> build with your own tools ' +
      '(starters are optional ideas) -> when the builder says "submit this", call prepare_submission, ' +
      'ask the builder only for what is missing, submit on the program\'s own site with your own ' +
      'browser/tools, then call record_submission. EarnKit does not build, judge, or pay out.',
  },
);

server.registerTool(
  'list_programs',
  {
    description:
      'List open builder programs with rewards. Use when the builder asks what is worth building. ' +
      'Returns id, title, organizer, reward, deadline, and track names.',
    annotations: { readOnlyHint: true },
  },
  () => call('list_programs'),
);

server.registerTool(
  'get_program',
  {
    description:
      'Full details for one program: description, reward, deadline, tracks, rules, requirements, ' +
      'submission requirements, source and submission links, and optional starters. Starters are ' +
      'only ideas; the builder can build anything that meets the requirements.',
    inputSchema: { program_id: z.string() },
    annotations: { readOnlyHint: true },
  },
  (input) => call('get_program', input),
);

server.registerTool(
  'prepare_submission',
  {
    description:
      'Call when the builder wants to submit. Pass everything you know about the project and any ' +
      'answers to program questions (keyed by submission requirement key). Returns what is complete, ' +
      'what is missing, and the submission link. Draft project-based answers yourself and confirm ' +
      'them; ask the builder for personal info. Never invent names, emails, wallets, or handles. ' +
      'Call again with the new answers until ready is true, then submit on the program\'s site.',
    inputSchema: {
      program_id: z.string(),
      project: project.optional(),
      answers: z.record(z.string(), z.string()).optional().describe('Answers by submission requirement key.'),
    },
    annotations: { readOnlyHint: true },
  },
  (input) => call('prepare_submission', input),
);

server.registerTool(
  'record_submission',
  {
    description:
      'Record the project on EarnKit. Only call AFTER the project was actually submitted on the ' +
      'program\'s own site. Pass the final answers that were submitted.',
    inputSchema: {
      program_id: z.string(),
      project: project.extend({ name: z.string() }),
      submission_data: z.record(z.string(), z.unknown()).describe('The final submitted answers, by key.'),
      external_submission_url: z.string().optional().describe('Link to the submission, if the site gave one.'),
    },
  },
  (input) => call('record_submission', input),
);

await server.connect(new StdioServerTransport());
