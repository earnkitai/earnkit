import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchProjectsInput, SKIP_REASONS, matchProjects, type MatchDeps } from './match-projects';
import { NO_USERS_YET, matchRepo, type ProgramFacts, type RepoFacts } from './match';
import { presentFirstMessage, submitStepLine, submitStep, type Card, type FirstMessage, type RepoFit, type YourRepos } from './present';
import { submitSiteName } from './programs';
import { matchRows } from './tools';
import { LEAD_NOTE } from './tools';
import { OLD_TOOL_NAMES, STALE_TOOLS_NOTE, aliasedIds, forOldClient, inOldWords } from './aliases';

/**
 * v2.10.1: the owner's 5 bugs from the live v2.10, each reproduced with the owner's real project
 * shapes (checked on GitHub on 2026-10-10):
 * - tokens.fun: minidevai/tokens.fun, a private repo in an org (404 to EarnKit), a live Base product
 *   with real fee revenue: a factory contract with thousands of transactions, a live site.
 * - EarnKit: earnkitai/earnkit, a private monorepo in EarnKit's own org, an MCP server, not a dapp.
 * - tipjar: jenil04/tipjar, a public starter from a template on Arc: a polished README, a live
 *   site, a handful of commits, no users.
 * The builder's GitHub login is jenil04; a connected agent (Claude Code) sends all three.
 */

const NOW = new Date('2026-10-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const TF_FACTORY = '0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a';
const TIPJAR_ARC = '0x3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b';

// The real program files' matching facts (programs/*.json).
const ARC: ProgramFacts = {
  id: 'arc-microgrants', title: 'Arc Microgrants', chains: ['arc'], any_chain: false, existing_work: 'allowed', tag: null,
  starts_at: null, investment: false, min_product_score: 0,
};
const BASE: ProgramFacts = {
  id: 'base-builder-grants', title: 'Base Builder Grant Program', chains: ['base'], any_chain: false, existing_work: 'allowed',
  tag: 'needs a live product', starts_at: null, investment: false, min_product_score: 0,
};
const A16Z: ProgramFacts = {
  id: 'a16z-speedrun', title: 'a16z speedrun SR008', chains: [], any_chain: true, existing_work: 'allowed', tag: 'long shot',
  starts_at: null, investment: true, min_product_score: 5,
};
const PROGRAMS = [ARC, BASE, A16Z];

const README = `# TipJar\n\n${'Fans tip creators in USDC on Arc; payouts settle in seconds. '.repeat(40)}`;
const json = (b: unknown, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });

/** GitHub as the owner's account has it: the tipjar is public; tokens.fun and EarnKit are private org repos (404). */
function github(u: URL): Response | undefined {
  const p = u.pathname;
  if (u.host === 'raw.githubusercontent.com' && p.startsWith('/jenil04/tipjar/')) {
    if (p.endsWith('/README.md')) return json(README);
    if (p.endsWith('/hardhat.config.ts')) return json(`networks: { arc: { url: 'https://rpc.arc.network', chainId: 5042 } } // ${TIPJAR_ARC}`);
    return undefined;
  }
  if (u.host !== 'api.github.com') return undefined;
  if (p === '/repos/jenil04/tipjar')
    return json({
      name: 'tipjar', full_name: 'jenil04/tipjar', html_url: 'https://github.com/jenil04/tipjar', homepage: 'https://tipjar-arc.vercel.app',
      default_branch: 'main', created_at: daysAgo(6), pushed_at: daysAgo(1), fork: false, archived: false, is_template: false,
      private: false, visibility: 'public', owner: { login: 'jenil04' }, description: 'Tips for creators in USDC on Arc', topics: [],
    });
  if (p.startsWith('/repos/jenil04/tipjar/git/trees/'))
    return json({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'hardhat.config.ts', type: 'blob', size: 120 }, { path: 'package.json', type: 'blob', size: 300 }] });
  // A fresh starter: 4 commits, all this week.
  if (p === '/repos/jenil04/tipjar/commits') return json(Array.from({ length: 4 }, (_, i) => ({ sha: `t${i}`, author: null })));
  if (p === '/search/commits') return json({ items: [] });
  return undefined; // minidevai/tokens.fun and earnkitai/earnkit: 404 (private)
}

async function withGitHub<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    return github(u) ?? json({ message: 'Not Found' }, 404);
  }) as typeof fetch;
  const log = console.error;
  console.error = () => {}; // the 404 contribution read logs one expected line
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
    console.error = log;
  }
}

/** Every live link loads; both contracts have code; tokens.fun's factory has 12,840 transactions on Base. */
function deps(): MatchDeps {
  const store = new Map<string, { ok: boolean; checked_at: Date; n?: number | null }>();
  return {
    now: NOW,
    programs: PROGRAMS,
    cache: { load: async () => null, save: async () => {} },
    checks: {
      probe: async () => {},
      getCode: async () => '0x6080',
      blockscout: async (url: string) => ({ transactions_count: url.toLowerCase().includes(TF_FACTORY) ? '12840' : '0' }),
      cache: { get: async (k) => store.get(k) ?? null, set: async (k, ok, now, extra) => void store.set(k, { ok, checked_at: now, n: extra?.n ?? null }) },
    },
  };
}

/** What Claude Code sends for the owner: the three repos by name, and the local view of each. */
const OWNER_INPUT = {
  github_user: 'jenil04',
  repos: ['minidevai/tokens.fun', 'earnkitai/earnkit', 'jenil04/tipjar'],
  local_repos: [
    { name: 'tokens.fun', url: 'https://github.com/minidevai/tokens.fun', chains: [{ chain: 'base', mainnet: true }], contracts: [TF_FACTORY], live_url: 'https://tokens.fun', last_commit_at: daysAgo(2) },
    // EarnKit: a monorepo with an MCP server; no contract of its own deployed.
    { name: 'earnkit', url: 'https://github.com/earnkitai/earnkit', chains: [], live_url: 'https://earnkit.com', last_commit_at: daysAgo(0) },
    { name: 'tipjar', url: 'https://github.com/jenil04/tipjar', chains: [{ chain: 'arc', mainnet: true }], contracts: [TIPJAR_ARC], live_url: 'https://tipjar-arc.vercel.app', last_commit_at: daysAgo(1) },
  ],
};

const ownerMatch = () => withGitHub(() => matchProjects(MatchProjectsInput.parse(OWNER_INPUT), deps()));

// ---- Bug 2: traction reflects real use ----

test('v2.10.1 B2: tokens.fun (private org repo, 12,840 Base transactions) is a product with good odds and outranks the tipjar starter; it is not "missing real users"', async () => {
  const r = await ownerMatch();
  const tf = r.fits.find((f) => f.repo === 'tokens.fun')!;
  const tip = r.fits.find((f) => f.repo === 'tipjar')!;
  assert.ok(tf, JSON.stringify(r));
  assert.equal(tf.product.tier, 'product', 'measured real use makes it a product');
  assert.equal(tf.product.odds, 'good');
  assert.ok(!tf.product.missing.includes('owned'), 'an org repo GitHub cannot read is never "not your repo"');
  assert.equal(tf.facts.tx_count, 12840);
  // Real use outweighs polish: tokens.fun's traction is above the starter's, and it ranks first.
  assert.ok(tf.product.traction! > tip.product.traction!, `${tf.product.traction} > ${tip.product.traction}`);
  assert.equal(r.fits[0].repo, 'tokens.fun');
  // Base Builder Grants: measured users clear "needs real users".
  const base = tf.verdicts.find((v) => v.program_id === BASE.id)!;
  assert.deepEqual([base.status, base.missing], ['likely', []]);
  // `matches` (what the agent reads): odds and traction, tokens.fun on top; no polish-only score.
  const rows = matchRows(r.fits as RepoFit[], new Set([A16Z.id]));
  for (const row of rows) assert.ok(!('product_score' in row), JSON.stringify(row));
  const tfRow = rows.find((x) => x.repo === 'tokens.fun' && x.program_id === BASE.id)!;
  assert.deepEqual([tfRow.status, tfRow.odds, tfRow.missing], ['likely', 'good', []]);
  assert.ok(tfRow.traction >= 8, String(tfRow.traction));
});

test('v2.10.1 B2: a starter never outscores a live product with revenue, in the matched table too', async () => {
  const r = await ownerMatch();
  const cards: Card[] = [
    { id: ARC.id, title: ARC.title, summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET', tag: null, each_time: [], ends_at: new Date('2026-10-15T03:59:00Z'), max_award_usd: 500, builder_fields: 1, chains: ['arc'], submit_site: 'DoraHacks' },
    { id: BASE.id, title: BASE.title, summary: 'up to $5,000 · rolling', tag: 'needs a live product', each_time: [], ends_at: null, max_award_usd: 5000, builder_fields: 0, chains: ['base'] },
    { id: A16Z.id, title: A16Z.title, summary: 'up to $1M investment', tag: 'long shot', each_time: [], ends_at: null, max_award_usd: 1_000_000, builder_fields: 0, any_chain: true, investment: true },
  ];
  const text = presentFirstMessage({ alerts: [], campaigns: [], cards, repos: r as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: true });
  assert.ok(text.indexOf('| Base Builder Grant Program |') < text.indexOf('| Arc Microgrants |'), text);
  assert.doesNotMatch(text, /tokens\.fun, (needs real users|low odds)/, text);
});

// ---- Bug 3: products-only programs ----

test('v2.10.1 B3: a16z never matches the tipjar starter as a fit: it is a step away, needs real users, low odds, and says so', async () => {
  const r = await ownerMatch();
  const tip = r.fits.find((f) => f.repo === 'tipjar')!;
  assert.equal(tip.product.score, 6, 'the starter has every polish signal');
  const a16z = tip.verdicts.find((v) => v.program_id === A16Z.id)!;
  assert.deepEqual([a16z.status, a16z.missing, a16z.note], ['after_step', ['real_users'], 'needs real users first']);
  const row = matchRows(r.fits as RepoFit[], new Set([A16Z.id])).find((x) => x.program_id === A16Z.id && x.repo === 'tipjar');
  if (row) assert.deepEqual([row.odds, row.low_reason, row.missing], ['low', NO_USERS_YET, ['real_users']]);
  // tokens.fun, with measured users, is the one a16z row (one per any-chain program), never low for users.
  const a16zRow = matchRows(r.fits as RepoFit[], new Set([A16Z.id])).filter((x) => x.program_id === A16Z.id);
  assert.deepEqual(a16zRow.map((x) => x.repo), ['tokens.fun']);
  // The tipjar still fits Arc Microgrants (demos are what it funds).
  const arc = tip.verdicts.find((v) => v.program_id === ARC.id)!;
  assert.equal(arc.status, 'likely');
});

test('v2.10.1 B3: matchRepo: a product-tier repo with no measured use gets a16z only as "needs real users first"; with 50+ transactions it is the company step', () => {
  const repo = (tx: number | null): RepoFacts => ({
    name: 'tipjar', url: 'https://github.com/jenil04/tipjar', homepage: 'https://tipjar.xyz', created_at: daysAgo(6),
    chains: { arc: { mainnet: true, testnet: false, evidence: 'hardhat', basis: 'deploy_config' } }, commits_in_window: {},
    product: { score: 6, tier: 'product', missing: [], traction: 3, odds: 'good', low_reason: null }, live_verified: true, tx_count: tx,
  });
  for (const tx of [null, 0, 49]) assert.deepEqual(matchRepo(repo(tx), [A16Z]).map((v) => [v.status, v.missing]), [['after_step', ['real_users']]]);
  assert.deepEqual(matchRepo(repo(50), [A16Z]).map((v) => [v.status, v.missing]), [['after_step', []]]);
});

// ---- Bug 4: no project dropped silently ----

test('v2.10.1 B4: EarnKit (earnkitai/earnkit, named and in local_repos) is never dropped silently: one "Not matched" line says why', async () => {
  const r = await ownerMatch();
  assert.deepEqual(r.skipped, [{ name: 'earnkit', reason: SKIP_REASONS.earnkit }]);
  const text = presentFirstMessage({ alerts: [], campaigns: [], cards: [arcCard], repos: r as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: false });
  assert.match(text, /^Not matched: earnkit \(EarnKit's own repo\)\.$/m, text);
  // Every other way a named repo can get no row says why too: no chain code, a fork.
  const more = await withGitHub(() =>
    matchProjects(
      MatchProjectsInput.parse({ local_repos: [{ name: 'notes-mcp', chains: [], live_url: 'https://notes.xyz', last_commit_at: daysAgo(1) }] }),
      // Without a16z (any chain): an MCP server with no chain code fits nothing on Arc or Base.
      { ...deps(), programs: [ARC, BASE] },
    ),
  );
  assert.deepEqual(more.skipped, [{ name: 'notes-mcp', reason: SKIP_REASONS.noChain }]);
});

// ---- Bug 1: a confirmed entry's only step left ----

const arcCard: Card = {
  id: ARC.id, title: ARC.title, summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET', tag: null, each_time: [],
  ends_at: new Date('2026-10-15T03:59:00Z'), max_award_usd: 500, builder_fields: 1, chains: ['arc'], submit_site: submitSiteName('dorahacks.io'),
};
const msg = (m: Partial<FirstMessage>): FirstMessage => ({
  alerts: [], campaigns: [], cards: [arcCard], repos: null, workingOn: [ARC.id], agentCanBuild: true, sponsorEntries: null, now: NOW, ...m,
});
const tipFit: YourRepos = {
  checked: 1,
  fits: [{ repo: 'tipjar', repo_url: null, verdicts: [{ program_id: ARC.id, program: ARC.title, status: 'likely', missing: [], effort: 'none', note: null }], product: { score: 6, tier: 'product', missing: [], traction: 3, odds: 'good', low_reason: null } }],
};

test('v2.10.1 B1: a confirmed Arc entry not submitted yet: the lead is the DoraHacks step, never "Want me to finish it?"', () => {
  const entries = [{ id: 41, program_id: ARC.id, title: ARC.title, name: 'tipjar', submitted: false }];
  assert.equal(submitSiteName('dorahacks.io'), 'DoraHacks');
  const t = presentFirstMessage(msg({ entries, repos: tipFit, more: false }));
  assert.deepEqual(t.split('\n'), [
    'Your entries: Arc Microgrants (tipjar, not submitted yet).',
    'Your tipjar entry for Arc Microgrants is ready. The only step left: submit it on DoraHacks by Oct 14. Did you submit it?',
  ]);
  assert.doesNotMatch(t, /finish it|keep going/);
  assert.equal((t.match(/\?/g) ?? []).length, 1);
  // "Show more" closes the same way, never "keep going" on a program already entered.
  const more = presentFirstMessage(msg({ entries, repos: tipFit, more: true }));
  assert.ok(more.endsWith('The only step left: submit it on DoraHacks by Oct 14. Did you submit it?'), more);
  assert.doesNotMatch(more, /keep going|start on Arc/);
  assert.match(more, /\| Arc Microgrants \(entered\) \|/);
  // Once submitted, the step is gone.
  assert.equal(submitStep(msg({ entries: [{ ...entries[0], submitted: true }] })), undefined);
  // The agent's note says what a yes to it means (tell, never prepare again).
  assert.match(LEAD_NOTE, /lead\.step is "submit"/);
  assert.equal(submitStepLine({ entry: entries[0], card: { ...arcCard, submit_site: null, summary: '500 USDC', ends_at: null } }), "Your tipjar entry for Arc Microgrants is ready. The only step left: submit it on the program's site. Did you submit it?");
});

// ---- Bug 5: replies name only the tools the client lists ----

test('v2.10.1 B5: a reply to an old tool name names only the old tools, in their argument words, and carries the refresh note', () => {
  const reply = {
    jsonrpc: '2.0',
    id: 7,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            show_to_builder: 'Fix it and tell me. Then you confirm it there.',
            note: `Show show_to_builder. ${LEAD_NOTE}`,
            pick_up: { question: 'Pick up your earlier entries?', agent_note: 'On yes, call tell with pickup: "yes"; on no, with answer "no".' },
            token: { agent_note: "Pass token exactly as shown (from prepare's token.proposed), or call confirm with project_id and yes: true. If they skip, skip_token: true; check: true reads it." },
            errors: ['No program with id "x". Call find for current ids.'],
          }),
        },
      ],
    },
  };
  const out = forOldClient(reply, 'list_programs') as { result: { content: { text: string }[] } };
  const body = JSON.parse(out.result.content[0].text) as Record<string, unknown>;
  const agentText = JSON.stringify({ ...body, show_to_builder: undefined });
  assert.doesNotMatch(agentText, /\b(call|Call|then|or) (find|prepare|confirm|tell)\b(?! (me|it))|\b(find|prepare|confirm|tell)'s\b|\byes: true\b|\bskip_token\b|\bcheck: true\b/, agentText);
  assert.match(agentText, /call prepare_submission\)/);
  assert.match(agentText, /call record_submission with builder_submitted: true and program_id: lead\.program_id\./);
  assert.match(agentText, /Call list_programs again with more: true/);
  assert.match((body.pick_up as { agent_note: string }).agent_note, /call pick_up_entries with answer: "yes"/);
  assert.match(agentText, /call launch_token with project_id and builder_confirmed: true/);
  assert.match(agentText, /prepare_submission's token\.proposed/);
  assert.match(agentText, /Call list_programs for current ids/);
  assert.match(agentText, /check_back: true/);
  assert.equal(body.show_to_builder, 'Fix it and tell me. Then you confirm it there.', 'builder text is left alone');
  assert.equal(body.tools_note, STALE_TOOLS_NOTE);
  // The note names no tool (old or new).
  assert.doesNotMatch(STALE_TOOLS_NOTE, new RegExp(`\\b(${[...OLD_TOOL_NAMES, 'find', 'prepare', 'confirm', 'tell'].join('|')})\\b`));
  // A plain-text error is rewritten too; get_program's caller is pointed back at get_program.
  assert.equal(inOldWords('Call find for current ids.', 'get_program'), 'Call get_program for current ids.');
  // Only old names count as aliased calls (by JSON-RPC id).
  assert.deepEqual(
    [...aliasedIds([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find' } }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'confirm_entry' } }], NOW)],
    [[2, 'confirm_entry']],
  );
});
