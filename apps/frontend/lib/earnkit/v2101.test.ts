import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchProjectsInput, SKIP_REASONS, matchProjects, type MatchDeps } from './match-projects';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_REAL_YET, NO_USERS_YET, USERS_UNKNOWN, matchRepo, reportedFacts, type ProgramFacts, type RepoFacts } from './match';
import { LOW_ODDS_HEADING, layout, presentFirstMessage, submitStepLine, starterRepo, usersAskLine, submitStep, type Card, type FirstMessage, type RepoFit, type YourRepos } from './present';
import { submitSiteName } from './programs';
import { matchRows } from './tools';
import { LEAD_NOTE } from './tools';
import { OLD_TOOL_NAMES, STALE_TOOLS_NOTE, aliasCall, aliasedIds, forOldClient, withOlderNames } from './aliases';

/**
 * v2.10.1: the owner's 5 bugs from the live v2.10, each reproduced with the owner's real project
 * shapes (checked on GitHub on 2026-10-10):
 * - tokens.fun: minidevai/tokens.fun, a private repo in an org (404 to EarnKit), no homepage on
 *   GitHub, no contract of its own (it launches through Clanker's and Uniswap's shared contracts on
 *   Base), a live site the agent reports, the builder's own commits in the local git log, and fee
 *   revenue EarnKit has no free way to measure (fix round 1, C1).
 * - EarnKit: earnkitai/earnkit, a private monorepo in EarnKit's own org, an MCP server, not a dapp.
 * - tipjar: jenil04/tipjar, a public starter from a template on Arc: a polished README, a live
 *   site, a handful of commits, no users.
 * The builder's GitHub login is jenil04; a connected agent (Claude Code) sends all three.
 */

const NOW = new Date('2026-10-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
/** Uniswap v4's PoolManager on Base: shared, busy, never tokens.fun's own (fix round 1, I1). */
const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';
/** A public Base repo's own contract, named only in a config file. */
const CONFIG_ONLY = '0x5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c';
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
      // Shared contracts and config-only contracts are busy; they must never read as anyone's real use.
      blockscout: async (url: string) => ({ transactions_count: /0x498581ff|0x5c5c5c5c/i.test(url) ? '99999' : '0' }),
      cache: { get: async (k) => store.get(k) ?? null, set: async (k, ok, now, extra) => void store.set(k, { ok, checked_at: now, n: extra?.n ?? null }) },
    },
  };
}

/** What Claude Code sends for the owner: the three repos by name, and the local view of each. */
const OWNER_INPUT = {
  github_user: 'jenil04',
  repos: ['minidevai/tokens.fun', 'earnkitai/earnkit', 'jenil04/tipjar'],
  local_repos: [
    // tokens.fun: no contract of its own to report; the live site; 153 of the builder's own commits in 90 days.
    { name: 'tokens.fun', url: 'https://github.com/minidevai/tokens.fun', chains: [{ chain: 'base', mainnet: true }], live_url: 'https://tokens.fun', last_commit_at: daysAgo(2), my_commits_90d: 153 },
    // EarnKit: a monorepo with an MCP server; no contract of its own deployed.
    { name: 'earnkit', url: 'https://github.com/earnkitai/earnkit', chains: [], live_url: 'https://earnkit.com', last_commit_at: daysAgo(0) },
    { name: 'tipjar', url: 'https://github.com/jenil04/tipjar', chains: [{ chain: 'arc', mainnet: true }], contracts: [TIPJAR_ARC], live_url: 'https://tipjar-arc.vercel.app', last_commit_at: daysAgo(1) },
  ],
};

type Said = { mainnet: []; testnet: []; live_url: null; has_users: boolean | null; not_mine: false };
const saidUsers = (has_users: boolean): Record<string, Said> => ({ 'minidevai/tokens.fun': { mainnet: [], testnet: [], live_url: null, has_users, not_mine: false } });
const ownerMatch = (o: { said?: Record<string, Said>; input?: object } = {}) =>
  withGitHub(() => matchProjects(MatchProjectsInput.parse({ ...OWNER_INPUT, ...o.input, ...(o.said && { said: o.said }) }), deps()));
const CARDS: Card[] = [
  { id: ARC.id, title: ARC.title, summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET', tag: null, each_time: [], ends_at: new Date('2026-10-15T03:59:00Z'), max_award_usd: 500, builder_fields: 1, chains: ['arc'], submit_site: 'DoraHacks' },
  { id: BASE.id, title: BASE.title, summary: 'up to $5,000 · rolling', tag: 'needs a live product', each_time: [], ends_at: null, max_award_usd: 5000, builder_fields: 0, chains: ['base'] },
  { id: A16Z.id, title: A16Z.title, summary: 'up to $1M investment', tag: 'long shot', each_time: [], ends_at: null, max_award_usd: 1_000_000, builder_fields: 0, any_chain: true, investment: true },
];
const reply = (repos: unknown, more = false) =>
  presentFirstMessage({ alerts: [], campaigns: [], cards: CARDS, repos: repos as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more });

// ---- Bug 2: traction reflects real use ----

test('v2.10.1 B2 (fix round 1, C1): the real tokens.fun (private org repo, no contract of its own, live site, the builder\'s commits) outranks the tipjar starter; EarnKit asks about users instead of leading the starter or saying "missing real users"', async () => {
  const r = await ownerMatch();
  const tf = r.fits.find((f) => f.repo === 'tokens.fun')!;
  const tip = r.fits.find((f) => f.repo === 'tipjar')!;
  assert.ok(tf, JSON.stringify(r));
  // The builder's own commits in the local git log stand in for the owner read GitHub can't do.
  assert.equal(tf.product.tier, 'product');
  assert.equal(tf.product.odds, 'good');
  assert.ok(!tf.product.missing.includes('owned'));
  assert.equal(tf.facts.tx_count ?? null, null, 'no contract of its own: nothing measured');
  assert.ok(tf.product.traction! > tip.product.traction!, `${tf.product.traction} > ${tip.product.traction}`);
  assert.equal(r.fits[0].repo, 'tokens.fun');
  // The first reply: the private line, the Not matched line, then one question about users, never
  // the starter's lead and never a silent "missing real users".
  assert.deepEqual(reply(r).split('\n'), [
    'tokens.fun is private, so I matched it from your local copy.',
    "Not matched: earnkit (EarnKit's own repo).",
    'tokens.fun could win up to $5,000 on Base with real users. Does it have real users or revenue? (yes/no)',
  ]);
  // "Show more": tokens.fun's Base row says why it is waiting.
  assert.match(reply(r, true), /\| Base Builder Grant Program \|[^\n]*\| tokens\.fun, low odds: no users yet \|/);
  // `matches`: odds and traction, no polish-only score.
  const rows = matchRows(r.fits as RepoFit[], new Set([A16Z.id]));
  for (const row of rows) assert.ok(!('product_score' in row), JSON.stringify(row));
});

test('v2.10.1 B2 (fix round 1, C1 b): the builder says yes: tokens.fun has real use, leads at Base, and a16z is its company step; no: the reason stays and the starter leads', async () => {
  const yes = await ownerMatch({ said: saidUsers(true) });
  const tf = yes.fits.find((f) => f.repo === 'tokens.fun')!;
  const base = tf.verdicts.find((v) => v.program_id === BASE.id)!;
  // The agent reported Base mainnet with no contract, so that stays a claim too (v2.9 A3).
  assert.deepEqual([base.status, base.missing, base.note], ['after_step', [], 'confirm: mainnet and users']);
  const a16z = tf.verdicts.find((v) => v.program_id === A16Z.id)!;
  assert.deepEqual([a16z.status, a16z.missing], ['after_step', []]);
  assert.equal(reply(yes).split('\n').at(-1), 'Your tokens.fun can win up to $5,000 on Base. Want me to finish it?');
  const rows = matchRows(yes.fits as RepoFit[], new Set([A16Z.id]));
  assert.deepEqual(rows.filter((x) => x.program_id === A16Z.id).map((x) => [x.repo, x.odds]), [['tokens.fun', 'good']]);
  // No: asked once, never again; the row keeps its reason and the starter's Arc row leads.
  const no = await ownerMatch({ said: saidUsers(false) });
  assert.equal(reply(no).split('\n').at(-1), 'Your tipjar can win 500 USDC on Arc by Oct 14. Want me to finish it?');
  assert.match(reply(no, true), /tokens\.fun, low odds: no users yet/);
});

test('v2.10.1 B2 (fix round 1, I1): a shared contract (PoolManager) the agent reports, or a busy contract a config file only mentions, is never real use', async () => {
  const tfLocal = { ...OWNER_INPUT.local_repos[0], contracts: [POOL_MANAGER] };
  const r = await ownerMatch({ input: { local_repos: [tfLocal, ...OWNER_INPUT.local_repos.slice(1)] } });
  const tf = r.fits.find((f) => f.repo === 'tokens.fun')!;
  assert.equal(tf.facts.tx_count ?? null, null);
  assert.deepEqual(tf.verdicts.find((v) => v.program_id === BASE.id)!.missing, ['real_users']);
  // Without the builder's commits it is not a product either: PoolManager never makes one.
  const bare = await ownerMatch({ input: { local_repos: [{ ...tfLocal, my_commits_90d: undefined }] } });
  assert.notEqual(bare.fits.find((f) => f.repo === 'tokens.fun')?.product.tier, 'product');
  // A public Base repo whose config names its own busy contract: traction counts it, real use doesn't.
  const original = globalThis.fetch;
  const pub = await withGitHub(async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      if (u.host === 'api.github.com' && u.pathname === '/repos/jenil04/baseapp')
        return json({ name: 'baseapp', full_name: 'jenil04/baseapp', html_url: 'https://github.com/jenil04/baseapp', homepage: 'https://baseapp.xyz', default_branch: 'main', created_at: daysAgo(200), pushed_at: daysAgo(1), fork: false, archived: false, private: false, visibility: 'public', owner: { login: 'jenil04' }, description: null, topics: [] });
      if (u.host === 'api.github.com' && u.pathname.startsWith('/repos/jenil04/baseapp/git/trees/'))
        return json({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'hardhat.config.ts', type: 'blob', size: 120 }] });
      if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/README.md')) return json(README);
      if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/hardhat.config.ts'))
        return json(`networks: { base: { url: 'https://mainnet.base.org', chainId: 8453 } } // ${CONFIG_ONLY} ${POOL_MANAGER}`);
      if (u.host === 'api.github.com' && u.pathname === '/repos/jenil04/baseapp/commits') return json([{ sha: 'a' }]);
      return inner(url);
    }) as typeof fetch;
    try {
      return await matchProjects(MatchProjectsInput.parse({ github_user: 'jenil04', repos: ['jenil04/baseapp'] }), { ...deps(), programs: [BASE] });
    } finally {
      globalThis.fetch = inner;
    }
  });
  globalThis.fetch = original;
  const app = pub.fits[0];
  assert.equal(app.facts.tx_count ?? null, null, 'a config mention is not real use');
  assert.deepEqual(app.verdicts[0].missing, ['real_users']);
});

test('v2.10.1 re-review m1, m2: a rate-limited owner read (403) is not a 404, so the local commit count never makes the repo the builder\'s or adds traction', async () => {
  const rateLimited = (input: object = {}) =>
    withGitHub(async () => {
      const inner = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        const u = new URL(String(url));
        if (u.host === 'api.github.com' && u.pathname === '/repos/minidevai/tokens.fun/commits') return json({ message: 'API rate limit exceeded' }, 403);
        return inner(url);
      }) as typeof fetch;
      try {
        return await matchProjects(MatchProjectsInput.parse({ ...OWNER_INPUT, ...input }), deps());
      } finally {
        globalThis.fetch = inner;
      }
    });
  const tf = (await rateLimited()).fits.find((f) => f.repo === 'tokens.fun')!;
  assert.notEqual(tf.product.tier, 'product', 'a 403 is not proof the repo is private');
  const bare = (await rateLimited({ local_repos: [{ ...OWNER_INPUT.local_repos[0], my_commits_90d: undefined }, ...OWNER_INPUT.local_repos.slice(1)] })).fits.find((f) => f.repo === 'tokens.fun')!;
  assert.equal(tf.product.traction, bare.product.traction, 'my_commits_90d adds traction only to the builder\'s own repo');
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
  // a16z shows one row per any-chain program: tokens.fun ranks first; without users it is low too, with the reason.
  const a16zRow = matchRows(r.fits as RepoFit[], new Set([A16Z.id])).filter((x) => x.program_id === A16Z.id);
  assert.deepEqual(a16zRow.map((x) => [x.repo, x.odds, x.low_reason]), [['tokens.fun', 'low', NO_USERS_YET]]);
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
  // Fix round 1 (I2): the builder's users claim counts too (Arc can't be measured).
  assert.deepEqual(matchRepo({ ...repo(null), claims: ['users'] }, [A16Z]).map((v) => [v.status, v.missing]), [['after_step', []]]);
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

test('v2.10.1 B5 (fix round 1, I3): a reply to an old tool name names each tool in both forms, keeps the new argument words (which the old names accept), and its note assumes no list', () => {
  const reply = {
    jsonrpc: '2.0',
    id: 7,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            show_to_builder: 'Fix it and tell me. Then you confirm it there.',
            note: `Show show_to_builder. ${LEAD_NOTE} Or find another program.`,
            pick_up: { question: 'Pick up your earlier entries?', agent_note: 'On yes, call tell with pickup: "yes"; on no, with answer "no".' },
            token: { agent_note: "Pass token exactly as shown (from prepare's token.proposed), or call confirm with project_id and yes: true." },
            errors: ['No program with id "x". Call find for current ids.', 'Then call find with program_id for its guide.'],
          }),
        },
      ],
    },
  };
  const out = forOldClient(reply, 'list_programs') as { result: { content: { text: string }[] } };
  const body = JSON.parse(out.result.content[0].text) as Record<string, unknown>;
  const agentText = JSON.stringify({ ...body, show_to_builder: undefined, tools_note: undefined });
  // Every tool reference carries its older name; none is left bare.
  assert.doesNotMatch(agentText, /\b(call|Call) (find|prepare|confirm|tell)\b(?! \()(?! (me|it)\b)/, agentText);
  assert.match(agentText, /call prepare \(prepare_submission if your tool list is older\)\)/);
  assert.match(agentText, /call tell \(tell_earnkit if your tool list is older\) with submitted: \{ program_id: lead\.program_id \}/);
  assert.match(agentText, /Call find \(list_programs if your tool list is older\) again with more: true/);
  assert.match(agentText, /call confirm \(confirm_entry if your tool list is older\) with project_id and yes: true/);
  assert.match(agentText, /prepare's \(prepare_submission's if your tool list is older\) token\.proposed/);
  assert.match(agentText, /Call find \(list_programs if your tool list is older\) for current ids/);
  // M4: "find" with a program id is get_program in the older list; prose "find another program" is untouched.
  assert.match(agentText, /call find \(get_program if your tool list is older\) with program_id/);
  assert.match(agentText, /Or find another program\./);
  assert.equal(body.show_to_builder, 'Fix it and tell me. Then you confirm it there.', 'builder text is left alone');
  assert.equal(body.tools_note, STALE_TOOLS_NOTE);
  assert.match(STALE_TOOLS_NOTE, /^If EarnKit's tools look out of date/);
  assert.doesNotMatch(STALE_TOOLS_NOTE, new RegExp(`\\b(${[...OLD_TOOL_NAMES, 'find', 'prepare', 'confirm', 'tell'].join('|')})\\b`));
  // The old names accept the new argument words the reply uses.
  assert.deepEqual(aliasCall('confirm_entry', { project_id: 4, yes: true }, NOW), { name: 'confirm', args: { project_id: 4, yes: true } });
  assert.deepEqual(aliasCall('tell_earnkit', { submitted: { program_id: 'arc-microgrants' } }, NOW), { name: 'tell', args: { submitted: { program_id: 'arc-microgrants' } } });
  assert.deepEqual(aliasCall('pick_up_entries', { pickup: 'yes' }, NOW), { name: 'tell', args: { pickup: 'yes' } });
  // Only old names count as aliased calls (by JSON-RPC id).
  assert.deepEqual(
    [...aliasedIds([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find' } }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'confirm_entry' } }], NOW)],
    [[2, 'confirm_entry']],
  );
  assert.equal(withOlderNames('Fix it and tell me.'), 'Fix it and tell me.');
});

test('v2.10.1 fix round 1 (I1): every Clanker and PoolManager address traction.ts skips is a shared contract matching skips too', async () => {
  const { CLANKER_ADDRESSES } = await import('./traction');
  const { SHARED_BASE_CONTRACTS } = await import('./shared-contracts');
  for (const a of CLANKER_ADDRESSES) assert.ok(SHARED_BASE_CONTRACTS.has(a), a);
  assert.equal(MatchProjectsInput.parse({ local_repos: [{ name: 'x', contracts: [POOL_MANAGER, '0x000000000022D473030F116dDEE9F6B43aC78BA3'] }] }).local_repos![0].contracts, undefined);
});

// ---- v2.10.2 (v2.11 T1, spec 8a, 8b): the odds fixes ----

/**
 * The owner's live case: Claude Code sends tokens.fun without the optional `my_commits_90d`. GitHub
 * 404s (a private org repo), it is live, and it has no contract of its own.
 */
const BARE_INPUT = { local_repos: [{ ...OWNER_INPUT.local_repos[0], my_commits_90d: undefined }, ...OWNER_INPUT.local_repos.slice(1)] };

test('v2.11 8a (1.3): tokens.fun with no my_commits_90d (404, live, active, no contract) is "unknown", never low or "not enough signs of a real product"', async () => {
  const r = await ownerMatch({ input: BARE_INPUT });
  const tf = r.fits.find((f) => f.repo === 'tokens.fun')!;
  assert.ok(tf, JSON.stringify(r.skipped));
  assert.equal(tf.product.tier, 'project');
  assert.equal(tf.product.odds, 'unknown');
  assert.notEqual(tf.product.low_reason, NOT_REAL_YET);
  assert.ok(tf.product.unchecked?.includes('owned'), 'owned is unchecked, never "not your repo"');
  // Its rows never say "low odds" for a repo EarnKit couldn't read: the Base row waits on users.
  const base = matchRows(r.fits as RepoFit[], new Set([A16Z.id])).find((x) => x.repo === 'tokens.fun' && x.program_id === BASE.id)!;
  assert.deepEqual([base.odds, base.low_reason], ['unknown', USERS_UNKNOWN]);
});

test('v2.11 8a (1.4): the first reply for tokens.fun with no my_commits_90d, plus the tipjar: the users question, exact lines', async () => {
  const r = await ownerMatch({ input: BARE_INPUT });
  assert.deepEqual(reply(r).split('\n'), [
    'tokens.fun is private, so I matched it from your local copy.',
    "Not matched: earnkit (EarnKit's own repo).",
    'tokens.fun could win up to $5,000 on Base with real users. Does it have real users or revenue? (yes/no)',
  ]);
  // "Show more": its Base row says users unknown, never "low odds".
  const more = reply(r, true);
  assert.match(more, /\| Base Builder Grant Program \|[^\n]*\| tokens\.fun, users unknown \|/);
  assert.doesNotMatch(more, /tokens\.fun, low odds/);
});

test('v2.11 8a (1.5): a yes makes tokens.fun the lead above the starter, with equal traction (3); a no keeps "no users yet" and the starter leads', async () => {
  const yes = await ownerMatch({ input: BARE_INPUT, said: saidUsers(true) });
  const tf = yes.fits.find((f) => f.repo === 'tokens.fun')!;
  const tip = yes.fits.find((f) => f.repo === 'tipjar')!;
  assert.deepEqual([tf.product.tier, tf.product.odds, tf.product.traction, tip.product.traction], ['product', 'good', 3, 3]);
  assert.equal(yes.fits[0].repo, 'tokens.fun', 'real use outranks the starter at a traction tie');
  assert.deepEqual(reply(yes).split('\n'), [
    'tokens.fun is private, so I matched it from your local copy.',
    "Not matched: earnkit (EarnKit's own repo).",
    'Your tokens.fun can win up to $5,000 on Base. Want me to finish it?',
  ]);
  // "Show more": tokens.fun's row is the first row.
  const table = reply(yes, true).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Program') && !l.startsWith('| ---'));
  assert.match(table[0], /tokens\.fun/, table.join('\n'));
  // The agent may send no last commit date either: still asked, and a yes still leads.
  const dateless = { local_repos: [{ ...BARE_INPUT.local_repos[0], last_commit_at: undefined }, ...BARE_INPUT.local_repos.slice(1)] };
  assert.equal(reply(await ownerMatch({ input: dateless })).split('\n').at(-1), 'tokens.fun could win up to $5,000 on Base with real users. Does it have real users or revenue? (yes/no)');
  assert.equal(reply(await ownerMatch({ input: dateless, said: saidUsers(true) })).split('\n').at(-1), 'Your tokens.fun can win up to $5,000 on Base. Want me to finish it?');
  const no = await ownerMatch({ input: BARE_INPUT, said: saidUsers(false) });
  assert.equal(reply(no).split('\n').at(-1), 'Your tipjar can win 500 USDC on Arc by Oct 14. Want me to finish it?');
  assert.match(reply(no, true), /tokens\.fun, low odds: no users yet/);
});

test('v2.11 8a (S5): real use outranks traction in layout rows and matchRows, for two good-odds repos with equal traction', () => {
  const product = { score: 6, tier: 'product' as const, missing: [], traction: 3, odds: 'good' as const, low_reason: null };
  const verdict = (id: string) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null });
  const facts = (name: string, claims: ('users')[]): RepoFacts => ({
    name, url: '', homepage: 'https://x.xyz', created_at: daysAgo(100), chains: { base: { mainnet: true, testnet: false, evidence: 'hardhat', basis: 'deploy_config' } },
    commits_in_window: {}, product, live_verified: true, tx_count: null, claims,
  });
  const starter: RepoFit = { repo: 'starter', repo_url: null, verdicts: [verdict(ARC.id), verdict(BASE.id)], product, facts: facts('starter', []) };
  const used: RepoFit = { repo: 'used', repo_url: null, verdicts: [verdict(BASE.id)], product, facts: facts('used', ['users']) };
  const rows = matchRows([starter, used], new Set());
  assert.deepEqual(rows.filter((x) => x.program_id === BASE.id).map((x) => x.repo), ['used', 'starter']);
  const shown = layout({ cards: CARDS, repos: { checked: 2, fits: [starter, used] } });
  assert.equal(shown.rows[0].repo, 'used', shown.rows.map((x) => `${x.repo}:${x.card.id}`).join(', '));
});

test('v2.11 8a (re-review m1 kept): a rate-limited owner read (403) is not a 404, so it is never "unknown" and never asked about', async () => {
  const r = await withGitHub(async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      if (u.host === 'api.github.com' && u.pathname === '/repos/minidevai/tokens.fun/commits') return json({ message: 'API rate limit exceeded' }, 403);
      return inner(url);
    }) as typeof fetch;
    try {
      return await matchProjects(MatchProjectsInput.parse({ ...OWNER_INPUT, ...BARE_INPUT }), deps());
    } finally {
      globalThis.fetch = inner;
    }
  });
  const tf = r.fits.find((f) => f.repo === 'tokens.fun')!;
  assert.notEqual(tf.product.odds, 'unknown');
  assert.notEqual(tf.product.tier, 'product');
});

// The real World's Fair program file (programs/colosseum-worlds-fair.json).
const WF_FILE = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/colosseum-worlds-fair.json'), 'utf8'));
const WF: ProgramFacts = {
  id: WF_FILE.id, title: WF_FILE.title, chains: WF_FILE.chains, any_chain: WF_FILE.any_chain ?? false, existing_work: WF_FILE.existing_work,
  tag: WF_FILE.tag ?? null, starts_at: new Date(WF_FILE.starts_at), investment: WF_FILE.investment ?? false, min_product_score: WF_FILE.min_product_score ?? 0,
};
const WF_CARD: Card = {
  id: WF.id, title: WF.title, summary: 'Tempo $100K, Base $25K tracks · closes Oct 12, 11:59 PM PT', tag: WF.tag, each_time: [],
  ends_at: new Date(WF_FILE.ends_at), max_award_usd: WF_FILE.max_award_usd, builder_fields: 4, chains: WF.chains,
};

test('v2.11 8b (1.2): the tipjar starter on the real World\'s Fair (Base reported) misses new_work, so it is low odds in matches and never "fit" in the show-more heading', async () => {
  assert.equal(WF.existing_work, 'new_work_only');
  const tipLocal = { ...OWNER_INPUT.local_repos[2], chains: [{ chain: 'arc', mainnet: true }, { chain: 'base', mainnet: true }] };
  // The build window is read only for a chain the repo's own files name, so its config names Base too.
  // Its transaction count can't be read, so the starter itself keeps its good odds.
  const base = deps();
  const wfDeps: MatchDeps = { ...base, checks: { ...base.checks!, blockscout: async () => ({}) } };
  const r = await withGitHub(async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/hardhat.config.ts'))
        return json(`networks: { arc: { url: 'https://rpc.arc.network', chainId: 5042 }, base: { url: 'https://mainnet.base.org', chainId: 8453 } } // ${TIPJAR_ARC}`);
      return inner(url);
    }) as typeof fetch;
    try {
      return await matchProjects(MatchProjectsInput.parse({ github_user: 'jenil04', repos: ['jenil04/tipjar'], local_repos: [tipLocal] }), { ...wfDeps, programs: [WF] });
    } finally {
      globalThis.fetch = inner;
    }
  });
  const tip = r.fits.find((f) => f.repo === 'tipjar')!;
  assert.equal(tip.product.odds, 'good', 'the starter itself has good odds');
  const v = tip.verdicts.find((x) => x.program_id === WF.id)!;
  assert.deepEqual(v.missing, ['new_work']);
  const [row] = matchRows(r.fits as RepoFit[], new Set());
  assert.deepEqual([row.program_id, row.odds, row.low_reason], [WF.id, 'low', 'only new work counts']);
  const more = presentFirstMessage({ alerts: [], campaigns: [], cards: [WF_CARD], repos: r as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: true });
  assert.doesNotMatch(more, /Your repos fit these open programs:/);
  assert.match(more, new RegExp(`^${LOW_ODDS_HEADING}`, 'm'));
  assert.match(more, /tipjar, low odds: only new work counts/);
});

// ---- v2.10.2 fix round 1 (review C1, I1, M6) ----

const CIRCLE: ProgramFacts = {
  id: 'circle-developer-grants', title: 'Circle Developer Grants', chains: ['arc'], any_chain: false, existing_work: 'allowed',
  tag: 'needs a live product', starts_at: null, investment: false, min_product_score: 0,
};
const CIRCLE_CARD: Card = {
  id: CIRCLE.id, title: CIRCLE.title, summary: '$5,000 to $100,000 USDC grants · rolling', tag: CIRCLE.tag, each_time: [], ends_at: null,
  max_award_usd: 100_000, builder_fields: 0, chains: ['arc'],
};
const withCircle = (o: { said?: Record<string, Said>; input?: object } = {}) =>
  withGitHub(() => matchProjects(MatchProjectsInput.parse({ ...OWNER_INPUT, ...BARE_INPUT, ...o.input, ...(o.said && { said: o.said }) }), { ...deps(), programs: [...PROGRAMS, CIRCLE] }));
const ARC_SUBMITTED = [{ id: 41, program_id: ARC.id, title: ARC.title, name: 'tipjar', submitted: true }];
const lastLine = (repos: unknown, entries = ARC_SUBMITTED) =>
  presentFirstMessage({ alerts: [], campaigns: [], cards: [...CARDS, CIRCLE_CARD], repos: repos as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: false, entries })
    .split('\n')
    .at(-1)!;

test('v2.10.2 fix round 1 (C1): with the Arc entry submitted, the users question is about tokens.fun, never the tipjar starter (Circle, a16z); a yes or a no is final and no repo is asked next', async () => {
  const r = await withCircle();
  const tip = r.fits.find((f) => f.repo === 'tipjar')!;
  // The starter waits only on users at Circle (a chain grant), and it is still never asked.
  assert.ok(tip.verdicts.some((v) => v.program_id === CIRCLE.id && v.missing.length === 1 && v.missing[0] === 'real_users'), JSON.stringify(tip.verdicts));
  assert.equal(lastLine(r), 'tokens.fun could win up to $5,000 on Base with real users. Does it have real users or revenue? (yes/no)');
  const yes = await withCircle({ said: saidUsers(true) });
  assert.equal(lastLine(yes), 'Your tokens.fun can win up to $5,000 on Base. Want me to finish it?');
  const no = await withCircle({ said: saidUsers(false) });
  assert.doesNotMatch(lastLine(no), /real users or revenue/);
  assert.doesNotMatch(lastLine(no), /tipjar could win/);
});

test('v2.10.2 fix round 1 (I1): an unknown repo whose only match is a program that doesn\'t need users is asked about (never stuck), and its row never says "users unknown"', async () => {
  const onArc = { ...BARE_INPUT.local_repos[0], chains: [{ chain: 'arc', mainnet: true }] };
  const r = await withGitHub(() => matchProjects(MatchProjectsInput.parse({ github_user: 'jenil04', repos: ['minidevai/tokens.fun'], local_repos: [onArc] }), { ...deps(), programs: [ARC] }));
  const tf = r.fits.find((f) => f.repo === 'tokens.fun')!;
  assert.equal(tf.product.odds, 'unknown');
  const text = presentFirstMessage({ alerts: [], campaigns: [], cards: [CARDS[0]], repos: r as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: false });
  assert.equal(text.split('\n').at(-1), 'tokens.fun could win 500 USDC on Arc with real users. Does it have real users or revenue? (yes/no)');
  const more = presentFirstMessage({ alerts: [], campaigns: [], cards: [CARDS[0]], repos: r as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: true });
  assert.match(more, /\| Arc Microgrants \|[^\n]*\| tokens\.fun \|/, more);
  assert.doesNotMatch(more, /users unknown|low odds/);
  // Fix round 1 (M4): "show more" never offers to start on an unknown row.
  assert.doesNotMatch(more, /start on Arc Microgrants with tokens\.fun/);
});

test('v2.10.2 fix round 1 (M6): the users question reads a range prize as "up to" the top', () => {
  assert.equal(
    usersAskLine({ repo: 'paylink', key: null, card: CIRCLE_CARD }),
    'paylink could win up to $100,000 on Arc with real users. Does it have real users or revenue? (yes/no)',
  );
});

// ---- v2.10.2 fix round 2 (re-review R1-I1): a starter is told apart by age or origin, never by traction ----

test('v2.10.2 fix round 2: tokens.fun as the builder\'s own public repo (no contract, live, few commits) is asked about users, though its traction is 3', async () => {
  // GitHub reads it (the builder's own, 300 days old, 2 commits in 90 days); no contract to measure.
  const pub = await withGitHub(async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const p = u.pathname;
      if (u.host === 'api.github.com' && p === '/repos/jenil04/tokens.fun')
        return json({ name: 'tokens.fun', full_name: 'jenil04/tokens.fun', html_url: 'https://github.com/jenil04/tokens.fun', homepage: 'https://tokens.fun', default_branch: 'main', created_at: daysAgo(300), pushed_at: daysAgo(2), fork: false, archived: false, is_template: false, private: false, visibility: 'public', owner: { login: 'jenil04' }, description: 'Launch a token in one click', topics: [] });
      if (u.host === 'api.github.com' && p.startsWith('/repos/jenil04/tokens.fun/git/trees/'))
        return json({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'wagmi.config.ts', type: 'blob', size: 120 }] });
      if (u.host === 'raw.githubusercontent.com' && p.startsWith('/jenil04/tokens.fun/') && p.endsWith('/README.md')) return json(README);
      if (u.host === 'raw.githubusercontent.com' && p.startsWith('/jenil04/tokens.fun/') && p.endsWith('/wagmi.config.ts')) return json(`import { base } from 'wagmi/chains'; chainId: 8453`);
      if (u.host === 'api.github.com' && p === '/repos/jenil04/tokens.fun/commits') return json([{ sha: 'a' }, { sha: 'b' }]);
      return inner(url);
    }) as typeof fetch;
    try {
      const local = { name: 'tokens.fun', url: 'https://github.com/jenil04/tokens.fun', chains: [{ chain: 'base', mainnet: true }], live_url: 'https://tokens.fun', last_commit_at: daysAgo(2) };
      return await matchProjects(MatchProjectsInput.parse({ github_user: 'jenil04', repos: ['jenil04/tokens.fun', 'jenil04/tipjar'], local_repos: [local, OWNER_INPUT.local_repos[2]] }), deps());
    } finally {
      globalThis.fetch = inner;
    }
  });
  const tf = pub.fits.find((f) => f.repo === 'tokens.fun')!;
  assert.ok(tf, JSON.stringify(pub.skipped));
  assert.deepEqual([tf.product.tier, tf.product.odds, tf.product.traction], ['product', 'good', 3]);
  assert.equal(reply(pub).split('\n').at(-1), 'tokens.fun could win up to $5,000 on Base with real users. Does it have real users or revenue? (yes/no)');
});

test('v2.10.2 fix round 2: private tokens.fun with my_commits_90d: 5 (traction 3) is asked about users', async () => {
  const five = { local_repos: [{ ...OWNER_INPUT.local_repos[0], my_commits_90d: 5 }, ...OWNER_INPUT.local_repos.slice(1)] };
  const r = await ownerMatch({ input: five });
  const tf = r.fits.find((f) => f.repo === 'tokens.fun')!;
  assert.deepEqual([tf.product.tier, tf.product.odds, tf.product.traction], ['product', 'good', 3]);
  assert.equal(reply(r).split('\n').at(-1), 'tokens.fun could win up to $5,000 on Base with real users. Does it have real users or revenue? (yes/no)');
});

test('v2.10.2 fix round 2: the 6-day-old tipjar is a starter: never asked about users, even alone with Circle and a16z waiting on users', async () => {
  const r = await withGitHub(() =>
    matchProjects(MatchProjectsInput.parse({ github_user: 'jenil04', repos: ['jenil04/tipjar'], local_repos: [OWNER_INPUT.local_repos[2]] }), { ...deps(), programs: [...PROGRAMS, CIRCLE] }),
  );
  const tip = r.fits.find((f) => f.repo === 'tipjar')!;
  assert.ok(starterRepo(tip as RepoFit, NOW));
  assert.ok(tip.verdicts.some((v) => v.program_id === CIRCLE.id && v.missing.join() === 'real_users'));
  const cards = [...CARDS, CIRCLE_CARD];
  const text = (entries: typeof ARC_SUBMITTED = []) =>
    presentFirstMessage({ alerts: [], campaigns: [], cards, repos: r as YourRepos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: false, entries });
  assert.doesNotMatch(text(), /real users or revenue/);
  assert.doesNotMatch(text(ARC_SUBMITTED), /real users or revenue/);
  // A local repo with a reported first commit under 30 days old is a starter too; with no age known, it is not.
  const local = (first_commit_at?: string) => ({ repo: 'x', repo_url: null, verdicts: [], product: { score: 6, tier: 'product' as const, missing: [] }, facts: reportedFacts({ name: 'x', chains: [], ...(first_commit_at && { first_commit_at }) }, []) });
  assert.equal(starterRepo(local(daysAgo(10)), NOW), true);
  assert.equal(starterRepo(local(daysAgo(40)), NOW), false);
  assert.equal(starterRepo(local(), NOW), false);
  assert.equal(starterRepo({ product: { score: 6, tier: 'product', missing: ['original'] }, facts: undefined }, NOW), true, 'a template or EarnKit starter');
  assert.equal(MatchProjectsInput.parse({ local_repos: [{ name: 'x', first_commit_at: daysAgo(3) }] }).local_repos![0].first_commit_at, daysAgo(3));
});
