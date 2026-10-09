import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * v2.3 token at submission, end to end against a local Postgres and a mock tokens.fun:
 *   DATABASE_URL=postgres://postgres@127.0.0.1:<port>/postgres?sslmode=disable \
 *   TOKENSFUN_API_URL=http://127.0.0.1:0 pnpm token:e2e
 * Port 0 picks a free port for the mock. TOKENSFUN_DEPLOY_API_KEY defaults to a dummy value; it
 * only ever reaches the mock. The gate's GitHub repo facts and the sanctions screen are faked through
 * ToolContext.tokenDeps, so nothing touches a real network and no real token is launched. v2.6: a
 * live link is not a gate; earnkit.txt needs only the agent's ticker-free "token: <code>" line.
 *
 * Flows (all through the `tools` layer, with the real database store):
 *   a. default: proposal CHAIN (CKB is taken), confirmed ticker and shown wallet passed back → launched;
 *      no wallet passed back → no coin (Ruling 30)
 *   b. an edited ticker launches as given; b2. a taken ticker (CKB) is never deployed (C6)
 *   c. token: 'skip' → skipped, no deploy
 *   d. gate failures: a fork with no new commits, no commits → gate_failed; no live link still launches
 *   e. a program with token_policy 'off' → skipped, and prepare_submission has no token block
 *   f. retry after pushing the line: (d)'s project without earnkit.txt, then with it → launched
 *   g. tokens.fun refuses (400) → failed, claim released; launch_token with another ticker launches
 *   h. no builder_confirmed → skipped
 *   i. the monogram route draws a PNG
 *   j. no answer (timeout) → pending, claim kept; launch_token is refused
 *   k. token omitted → skipped ("pass token"); launch_token without a wallet fails (never the remembered one), with it launches the stored proposal
 *   l. a 502 "Deployment status unknown" → pending, claim kept; launch_token is refused
 *   m. a project that already has a token → skipped at submission, failed via launch_token
 *   n. ownership: no earnkit.txt → gate_failed with the line to add
 *   o. one token per repo: a second entry of (a)'s repo → skipped; launch_token on it → failed
 *   p. the per-installation limit: a fresh agent launches 3, the 4th is failed
 *   q. no deploy key: no token block, and record_submission → skipped, nothing checked or sent
 *   r. through the MCP server: token.proposed echoed verbatim (with `image`) launches
 *   s. earnkit.txt without the token line (a payout_wallet line only) → gate_failed
 *   t. someone else's repo: the line for another agent is refused (even with its wallet)
 *   u. the links change between the gate and the claim (a concurrent launch_token) → failed, no deploy
 * The mock also serves earnkit.txt (EARNKIT_OWNERSHIP_BASE_URL, NODE_ENV=test), read by the real
 * ownership fetch: the "token: <code>" line EarnKit gives each of the builder's agents (OWNERS) for that
 * repo, any ticker, except for repos named "noproof" (no file), "late" (no file until (f) pushes it),
 * "notoken" (a payout_wallet line only) and "victim" (another builder's file, for their own agent).
 *   v. a third party copies the owner's full token line: refused for the third party's agent; the
 *      owner's own launch with that line then succeeds
 *   w. v2.8 confirm_entry: the offer; yes launches and returns the kit; a second yes deploys nothing;
 *      record_submission updates that entry; skip; no wallet, a taken ticker and a missing proof line
 *      are fixable (no kit); an agent that can't push gets the kit with no launch
 *   x. v2.8.1 §A: the offer names $TICKER (Name); a 503 "Pending transactions" is retried once and
 *      launches; nothing minted twice releases the claim ("say go") and go launches; tokens.fun's
 *      wallet limit says "Try again after HH:MM UTC"; a slow deploy replies "launching" (no kit)
 *      within the reply time and the next call returns the token and the kit
 */
function guardFail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Safety guard, checked before any app module is imported: this script writes rows and sends
// deploy requests, so only a local Postgres and a mock tokens.fun on 127.0.0.1 are allowed.
let dbHost = '';
try {
  dbHost = new URL(process.env.DATABASE_URL ?? '').hostname;
} catch {
  guardFail('DATABASE_URL is missing or not a valid URL.');
}
if (dbHost !== 'localhost' && dbHost !== '127.0.0.1')
  guardFail(`DATABASE_URL must point at localhost or 127.0.0.1 (got host ${JSON.stringify(dbHost)}).`);
const apiUrl = process.env.TOKENSFUN_API_URL ?? '';
const portMatch = apiUrl.match(/^http:\/\/127\.0\.0\.1:(\d+)\/?$/);
if (!portMatch)
  guardFail('TOKENSFUN_API_URL must be http://127.0.0.1:<port> (0 picks a free port for the mock).');
process.env.TOKENSFUN_DEPLOY_API_KEY ||= 'e2e-mock-key';
// Token lines are HMACs under this secret; a dummy value unless the caller sets one.
process.env.EARNKIT_AUTH_SECRET ||= 'e2e-auth-secret';
(process.env as Record<string, string>).NODE_ENV = 'test'; // allows EARNKIT_OWNERSHIP_BASE_URL
const KEY = process.env.TOKENSFUN_DEPLOY_API_KEY;
delete process.env.EARNKIT_TOKENSFUN_TIMEOUT_MS;

// ---- the mock tokens.fun ----
const TOKEN_ADDRESS = '0x' + 'ab'.repeat(20);
const WALLET = '0x' + '12'.repeat(20);
const VICTIM_WALLET = '0x' + '34'.repeat(20);
const ownershipReads: string[] = [];
// The installations whose token lines the builder's earnkit.txt carries (set once they exist).
const OWNERS = new Set<number>();
let lineFor: (installationId: number, repoUrl: string) => string | null = () => null;
// The other builder's agent (an installation id never created here): their file carries its line.
const VICTIM_AGENT = 2_000_000_000;
// "late" repos whose earnkit.txt has been pushed ((f)).
const pushed = new Set<string>();
const deploys: Record<string, unknown>[] = [];
let authFailures = 0;
const hanging = new Set<IncomingMessage>();
// v2.8.1 §A1: how many 503 "Pending transactions" answers each ticker still gets before it deploys.
const busyLeft = new Map<string, number>([['BUSYA', 1], ['BUSYB', 2]]);
const LIMIT_AT = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 60_000) * 60_000);
const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  // earnkit.txt, as raw.githubusercontent.com would serve it (no key: it isn't tokens.fun).
  const file = url.pathname.match(/^\/([^/]+)\/([^/]+)\/HEAD\/earnkit\.txt$/);
  if (req.method === 'GET' && file) {
    ownershipReads.push(file[2]);
    if (file[2].includes('noproof') || (file[2].includes('late') && !pushed.has(file[2]))) {
      res.writeHead(404);
      return res.end('404: Not Found');
    }
    const repo = `https://github.com/${file[1]}/${file[2]}`;
    const text = file[2].includes('victim')
      ? `payout_wallet: ${VICTIM_WALLET}\n${lineFor(VICTIM_AGENT, repo)}\n`
      : file[2].includes('notoken')
        ? `# e2e\npayout_wallet: ${WALLET}\n`
        : `# e2e\n${[...OWNERS].map((id) => `${lineFor(id, repo)}\n`).join('')}`;
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(text);
  }
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    authFailures++;
    return json(401, { error: 'Unauthorized' });
  }
  if (req.method === 'GET' && url.pathname === '/api/check-ticker')
    return json(200, { available: url.searchParams.get('symbol') !== 'CKB' });
  if (req.method === 'POST' && url.pathname === '/api/v1/deploy') {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    deploys.push(body);
    if (body.symbol === 'FAIL4') return json(400, { error: 'mock refusal' });
    if (body.symbol === 'HANG5') {
      hanging.add(req); // never answered
      return;
    }
    if (body.symbol === 'UNKN6') return json(502, { error: 'Deployment status unknown' });
    // v2.8.1 §A1: tokens.fun's gas wallet busy ("Pending transactions detected", nothing minted).
    const busy = (busyLeft.get(String(body.symbol)) ?? 0);
    if (busy > 0) {
      busyLeft.set(String(body.symbol), busy - 1);
      return json(503, { error: 'Pending transactions detected. Try again in a few minutes.', pendingCount: 1 });
    }
    // v2.8.1 §A4: the EarnKit-key wallet limit, with tokens.fun's retry_after.
    if (body.symbol === 'LIMW') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7200' });
      // tokens.fun T1 (cc46fa2): retry_after { at, seconds }, minted:false, and the header.
      return res.end(JSON.stringify({ error: 'Daily token limit reached', retry_after: { at: LIMIT_AT.toISOString(), seconds: 7200 }, minted: false }));
    }
    // v2.8.1 §A5: a deploy slower than the reply time.
    if (body.symbol === 'SLOW') await new Promise((r) => setTimeout(r, 1_500));
    return json(200, {
      success: true,
      tokenAddress: TOKEN_ADDRESS,
      txHash: '0x' + 'cd'.repeat(32),
      chainId: body.chainId,
      urls: { tokensfun: `https://tokens.fun/coin/${TOKEN_ADDRESS}` },
    });
  }
  json(404, { error: 'not found' });
});
await new Promise<void>((resolve) => server.listen(Number(portMatch[1]), '127.0.0.1', resolve));
const mockPort = (server.address() as AddressInfo).port;
// Set before the app modules that read TOKENSFUN_API_URL at import time are loaded.
process.env.TOKENSFUN_API_URL = `http://127.0.0.1:${mockPort}`;
process.env.EARNKIT_OWNERSHIP_BASE_URL = `http://127.0.0.1:${mockPort}`;

// v2.9 A5: link and contract checks stay offline here (every link loads, every address has code).
await import('../lib/earnkit/fixtures/no-network-checks');
const { sql } = await import('../lib/earnkit/db');
const { upsertProgram } = await import('../lib/earnkit/programs');
const { ProgramFile } = await import('../lib/earnkit/program-file');
const { tools } = await import('../lib/earnkit/tools');
const { createMcpServer } = await import('../lib/earnkit/mcp');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { LINKS_CHANGED, LAUNCH_STUCK } = await import('../lib/earnkit/tokens');
type Ctx = import('../lib/earnkit/tools').ToolContext;
type GateDeps = import('../lib/earnkit/token-gate').GateDeps;
type TokenOutcome = import('../lib/earnkit/tokens').TokenOutcome;

let checks = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  if (!ok) {
    console.error(`FAIL: ${label}${detail === undefined ? '' : `\n  got: ${JSON.stringify(detail)}`}`);
    server.closeAllConnections();
    process.exit(1);
  }
  checks++;
  console.log(`ok ${checks} - ${label}`);
}

// ---- database ----
const db = sql();
await db.unsafe(readFileSync(join(import.meta.dirname, '..', 'db', 'schema.sql'), 'utf8'));
const program = (id: string, token_policy: 'encouraged' | 'off') =>
  ProgramFile.parse({
    id,
    organizer: 'EarnKit e2e',
    title: `Token e2e (${token_policy})`,
    description: 'A local test program for the v2.3 token e2e.',
    source_url: 'https://earnkit.com',
    submission_url: 'https://earnkit.com/submit',
    reward: 'Nothing; a test.',
    summary: 'test · rolling',
    starts_at: null,
    ends_at: null,
    verified_at: '2026-10-04',
    status: 'active',
    existing_work: 'allowed',
    token_policy,
    chains: ['base'],
    setup: [],
    each_time: [],
    rules: ['A test program.'],
    submission_requirements: [
      { key: 'notes', label: 'Notes', type: 'text', required: false, from: 'builder' },
    ],
  });
const ON = 'e2e-token-encouraged';
const OFF = 'e2e-token-off';
await upsertProgram(program(ON, 'encouraged'));
await upsertProgram(program(OFF, 'off'));
const newInstallation = async () =>
  (
    await db<{ id: number }[]>`
      INSERT INTO installations (token_hash, payout_wallet)
      VALUES (${'e2e-token-' + Date.now() + '-' + Math.random()}, ${WALLET}) RETURNING id`
  )[0];
const inst = await newInstallation();
lineFor = (await import('../lib/earnkit/token-gate')).tokenLineFor;
OWNERS.add(inst.id);

// ---- helpers ----
// GitHub's repo facts and the sanctions screen are faked; earnkit.txt is read for real (from the mock).
const passGate: GateDeps = {
  repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
  screen: async () => {},
};
// The daily launch limit is lifted for the main agent (it launches more than 3); (p) tests it.
const ctx = (gate: GateDeps = passGate): Ctx => ({
  installationId: inst.id,
  tokenDeps: { gate, limit: async () => {} },
});
let seq = 0;
const project = (name: string, extra: Record<string, string> = {}, tag = '') => {
  seq++;
  return {
    name,
    repo_url: `https://github.com/e2e-builder/token-e2e-${tag}${Date.now()}-${seq}`,
    live_url: `https://token-e2e-${seq}.tipjar.xyz`,
    ...extra,
  };
};
type Recorded = { recorded: boolean; project_id: number; token: TokenOutcome };
const submit = async (
  // Ruling 30: the agent echoes the wallet shown on the wallet line (prepare_submission's
  // shown_wallet, here the installation's WALLET); null: the agent omitted it.
  a: { program?: string; project: Record<string, string>; token?: unknown; confirmed?: boolean; wallet?: string | null },
  gate?: GateDeps,
  c: Ctx = ctx(gate),
) =>
  (await tools.record_submission(
    {
      program_id: a.program ?? ON,
      project: a.project,
      submission_data: { notes: 'e2e' },
      ...(a.wallet !== null && { payout_wallet: a.wallet ?? WALLET }),
      ...(a.token !== undefined && { token: a.token }),
      ...(a.confirmed !== undefined && { builder_confirmed: a.confirmed }),
    },
    c,
  )) as Recorded;
const launch = (input: Record<string, unknown>, gate?: GateDeps) =>
  tools.launch_token({ builder_confirmed: true, ...input }, ctx(gate)) as Promise<TokenOutcome>;
const row = async (id: number) =>
  (
    await db<
      {
        token_url: string | null;
        token_status: string | null;
        token_symbol: string | null;
        token_name: string | null;
        live_url: string | null;
        token_repo_key: string | null;
      }[]
    >`SELECT token_url, token_status, token_symbol, token_name, live_url, token_repo_key FROM projects WHERE id = ${id}`
  )[0];
const lastDeploy = () => deploys[deploys.length - 1];

// (a) default: the proposal, confirmed and passed back.
let aProjectId = 0;
let aRepo = '';
{
  const p = project('Chain Kit Builder');
  const prep = (await tools.prepare_submission({ program_id: ON, project: { name: p.name } }, ctx())) as {
    token?: { proposed: { name: string; symbol: string } | null; creator_wallet: string | null };
    shown_wallet?: string;
    show_to_builder: string;
  };
  // Ruling 30: the wallet on the line comes back as a field to echo.
  check(prep.shown_wallet === WALLET, '(a) shown_wallet is the wallet on the wallet line', prep);
  // The agent omits it: recorded with no coin; the remembered wallet is never read at record time.
  {
    const before = deploys.length;
    const none = (await submit({ project: project('No Wallet Echo'), token: { name: 'No Wallet Echo', symbol: 'NOECH' }, confirmed: true, wallet: null })) as Recorded & { show_to_builder?: string };
    check(
      none.recorded === true && none.token.status === 'skipped' && none.token.no_wallet === true && deploys.length === before &&
        /Reply with a wallet to get your token/.test(none.show_to_builder ?? ''),
      '(a) no wallet passed back → recorded, no coin, the plain no-wallet line',
      none,
    );
  }
  check(prep.token?.proposed?.symbol === 'CHAIN', '(a) proposed ticker is CHAIN (CKB is taken)', prep.token);
  // v2.8 Part C: an active non-campaign program has the builder bonus: the offer bundles it with the token.
  check(
    prep.show_to_builder.includes('\n\nReady. Want the builder bonus? It comes with a token.\n') &&
      prep.show_to_builder.includes('\nSkip: no token, no builder bonus.\n'),
    '(a) the confirmation offer: the builder bonus comes with a token; skip costs both',
    prep.show_to_builder,
  );
  // The remembered wallet is on the offer's wallet line, short (one yes confirms both).
  check(prep.show_to_builder.includes('Wallet for fees and any bonus: 0x1212…1212 (used last time), or tell me another.'), '(a) the offer prefills the remembered wallet', prep.show_to_builder);
  check(prep.token?.creator_wallet === WALLET, '(a) creator wallet is the remembered wallet');
  const before = deploys.length;
  const r = await submit({ project: p, token: { name: prep.token!.proposed!.name, symbol: 'CHAIN' }, confirmed: true });
  check(r.recorded === true, '(a) submission recorded');
  check(r.token.status === 'launched' && r.token.symbol === 'CHAIN', '(a) token launched as CHAIN', r.token);
  check(r.token.tokens_fun === `https://tokens.fun/coin/${TOKEN_ADDRESS}`, '(a) tokens.fun page returned');
  const body = lastDeploy();
  check(deploys.length === before + 1, '(a) one deploy sent');
  check(body.creatorWallet === WALLET, '(a) mock saw the creator wallet', body);
  // v2.10 item 12: no upload and no site logo (no-network-checks): the generated mark, never the text tile.
  check(typeof body.imageUrl === 'string' && body.imageUrl.endsWith(`/api/projects/${r.project_id}/mark`), '(a) image is the generated mark route', body.imageUrl);
  check(ownershipReads.includes(p.repo_url.split('/').pop()!), '(a) earnkit.txt was read');
  check(!('twitter' in body), '(a) no twitter field');
  check(body.chainId === 8453 && body.source === 'earnkit', '(a) Base chain, source earnkit');
  const saved = await row(r.project_id);
  check(saved.token_url === `https://tokens.fun/coin/${TOKEN_ADDRESS}` && saved.token_status === 'launched', '(a) project row has the token', saved);
  check(saved.token_repo_key === p.repo_url.replace('https://', ''), '(a) token_repo_key is the normalized repo', saved);
  // The fee line and both terms links close the offer; the kit is not in this reply (ordering rule).
  check(
    prep.show_to_builder.includes('Fees in WETH; tokens.fun pays gas.') &&
      !/clanker/i.test(prep.show_to_builder) &&
      prep.show_to_builder.includes('risk-disclosure') &&
      !/"(kit|submission_url)":/.test(JSON.stringify(prep)),
    '(a) the offer carries the fee line and terms; no kit or submission link before the confirmation',
    prep,
  );
  aProjectId = r.project_id;
  aRepo = p.repo_url;
}

// (b) an edited ticker.
{
  const r = await submit({ project: project('Kit Studio'), token: { name: 'Kit Studio', symbol: 'KITS' }, confirmed: true });
  check(r.token.status === 'launched' && r.token.symbol === 'KITS', '(b) edited ticker launches as KITS', r.token);
  check(lastDeploy().symbol === 'KITS', '(b) mock saw KITS');
}

// (b2) C6: a ticker tokens.fun already has (CKB) is never deployed; the builder gets a free suggestion.
{
  const before = deploys.length;
  const r = await submit({ project: project('Kit Bench'), token: { name: 'Kit Bench', symbol: 'CKB' }, confirmed: true });
  check(r.token.status === 'skipped' && /^That ticker is taken\. Pick another, or say go for \$[A-Z0-9]+\.$/.test(r.token.note ?? ''), '(b2) taken ticker: skipped, with a suggestion', r.token);
  check(deploys.length === before, '(b2) no deploy sent');
}

// (c) the builder said no token.
{
  const before = deploys.length;
  const r = await submit({ project: project('No Token App'), token: 'skip', confirmed: true });
  check(r.token.status === 'skipped', '(c) token skipped', r.token);
  check(deploys.length === before, '(c) no deploy sent');
}

// (d) gate failures (Ruling 3 (plan): a repo with real code); the live link is no longer one.
let retryProjectId = 0;
let retryRepo = '';
{
  const before = deploys.length;
  const late = project('Retry Demo', {}, 'late-');
  const noFile = await submit({ project: late, token: { name: 'Retry Demo', symbol: 'RETRY' }, confirmed: true });
  check(noFile.token.status === 'gate_failed' && /earnkit\.txt/.test(noFile.token.agent_note ?? ''), '(d) no earnkit.txt yet → gate_failed', noFile.token);
  retryProjectId = noFile.project_id;
  retryRepo = late.repo_url;
  const fork = await submit(
    { project: project('Forked Thing'), token: { name: 'Forked Thing', symbol: 'FORKD' }, confirmed: true },
    { ...passGate, repo: async () => ({ fork: true, hasCommits: true, aheadOfParent: 0 }) },
  );
  check(fork.token.status === 'gate_failed' && /fork with no new commits/.test(fork.token.note ?? ''), '(d) fork with no new commits → gate_failed', fork.token);
  // The v2.6 cases run on a second agent of the builder: the main agent's 20 submissions a day are spoken for.
  const second = await newInstallation();
  OWNERS.add(second.id);
  const on = (gate: GateDeps): Ctx => ({ installationId: second.id, tokenDeps: { gate, limit: async () => {} } });
  const empty = await submit(
    { project: project('Empty Repo'), token: { name: 'Empty Repo', symbol: 'EMPTY' }, confirmed: true },
    undefined,
    on({ ...passGate, repo: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }) }),
  );
  check(empty.token.status === 'gate_failed' && /no commits/.test(empty.token.note ?? ''), '(d) no commits → gate_failed', empty.token);
  check(deploys.length === before, '(d) no deploys on gate failures');
  const { live_url: _l, ...noLive } = project('Offline App');
  const nl = await submit({ project: noLive, token: { name: 'Offline App', symbol: 'OFFL' }, confirmed: true }, undefined, on(passGate));
  check(nl.token.status === 'launched' && nl.token.symbol === 'OFFL', '(d) no live link: still launches (v2.6)', nl.token);
  const forkAhead = await submit(
    { project: project('Own Fork'), token: { name: 'Own Fork', symbol: 'OWNFK' }, confirmed: true },
    undefined,
    on({ ...passGate, repo: async () => ({ fork: true, hasCommits: true, aheadOfParent: 2 }) }),
  );
  check(forkAhead.token.status === 'launched', '(d) a fork with new commits launches', forkAhead.token);
}

// (e) a program that doesn't allow tokens.
{
  const prep = (await tools.prepare_submission({ program_id: OFF, project: { name: 'Off Program App' } }, ctx())) as Record<string, unknown>;
  check(!('token' in prep), '(e) off program: prepare_submission has no token block');
  const r = await submit({ program: OFF, project: project('Off Program App'), token: { name: 'Off Program App', symbol: 'OFFP' }, confirmed: true });
  check(r.token.status === 'skipped' && /doesn't allow tokens/.test(r.token.note ?? ''), '(e) off program → skipped', r.token);
}

// (f) retry after pushing the line: still no file, then the agent pushes it; the stored ticker launches.
{
  const still = await launch({ project_id: retryProjectId });
  check(still.status === 'gate_failed' && still.agent_note?.includes(`"${lineFor(inst.id, retryRepo)}"`) === true, '(f) retry before the push → gate_failed with the line (agent note)', still);
  pushed.add(retryRepo.split('/').pop()!);
  const r = await launch({ project_id: retryProjectId });
  check(r.status === 'launched' && r.symbol === 'RETRY', '(f) launch_token after the push launches the stored RETRY', r);
  check(lastDeploy().symbol === 'RETRY', '(f) mock saw RETRY');
}

// (g) tokens.fun refuses before minting: the claim is released.
{
  const r = await submit({ project: project('Fail Case'), token: { name: 'Fail Case', symbol: 'FAIL4' }, confirmed: true });
  check(r.token.status === 'failed' && /mock refusal/.test(r.token.note ?? ''), '(g) 400 refusal → failed', r.token);
  const saved = await row(r.project_id);
  check(saved.token_url === null && saved.token_status === 'failed', '(g) claim released (token_url IS NULL)', saved);
  const again = await launch({ project_id: r.project_id, symbol: 'KITS2' });
  check(again.status === 'launched' && again.symbol === 'KITS2', '(g) second try with KITS2 launches', again);
}

// (h) not confirmed.
{
  const before = deploys.length;
  const r = await submit({ project: project('Unconfirmed App'), token: { name: 'Unconfirmed App', symbol: 'UNCF' } });
  check(r.token.status === 'skipped' && /builder_confirmed/.test(r.token.agent_note ?? ''), '(h) unconfirmed → skipped', r.token);
  check(deploys.length === before, '(h) no deploy sent');
}

// (i) the monogram route, called directly.
{
  const { GET } = await import('../app/api/projects/[id]/token-image/route');
  const get = (q: string) =>
    GET(new Request(`http://localhost/api/projects/${aProjectId}/token-image${q}`), {
      params: Promise.resolve({ id: String(aProjectId) }),
    });
  const stale = await get('?s=OTHER');
  check(stale.status === 404 && (await get('')).status === 404, '(i) another or no ticker in the link → 404');
  const res = await get('?s=CHAIN');
  const bytes = Buffer.from(await res.arrayBuffer());
  check(res.status === 200 && res.headers.get('content-type') === 'image/png', '(i) monogram is image/png', {
    status: res.status,
    type: res.headers.get('content-type'),
  });
  check(bytes.length > 0 && bytes.subarray(1, 4).toString('latin1') === 'PNG', '(i) monogram body is a PNG');
}

// (i2) v2.10 item 12: the generated mark route, called directly: a PNG, cached for a year; 404 for a bad id.
{
  const { GET } = await import('../app/api/projects/[id]/mark/route');
  const get = (id: string) => GET(new Request(`http://localhost/api/projects/${id}/mark`), { params: Promise.resolve({ id }) });
  const res = await get(String(aProjectId));
  const bytes = Buffer.from(await res.arrayBuffer());
  check(res.status === 200 && res.headers.get('content-type') === 'image/png', '(i2) the mark is image/png', { status: res.status, type: res.headers.get('content-type') });
  check(bytes.subarray(1, 4).toString('latin1') === 'PNG', '(i2) the mark body is a PNG');
  check(/immutable/.test(res.headers.get('cache-control') ?? ''), '(i2) the mark is cached as immutable');
  check((await get('abc')).status === 404 && (await get('1.5')).status === 404, '(i2) a non-integer id → 404');
}

// (j) no answer from tokens.fun: pending, the claim kept.
{
  process.env.EARNKIT_TOKENSFUN_TIMEOUT_MS = '1000';
  const r = await submit({ project: project('Hang Case'), token: { name: 'Hang Case', symbol: 'HANG5' }, confirmed: true });
  delete process.env.EARNKIT_TOKENSFUN_TIMEOUT_MS;
  check(r.token.status === 'pending', '(j) timeout → pending', r.token);
  const saved = await row(r.project_id);
  check(saved.token_url === 'pending' && saved.token_status === 'pending', '(j) claim kept (token_url = pending)', saved);
  const before = deploys.length;
  const again = await launch({ project_id: r.project_id });
  // v2.8.1 §A1: the deploy answered without a result, so it is said plainly, never retried.
  check(again.status === 'pending' && again.note === LAUNCH_STUCK, '(j) later launch_token is refused (unconfirmed, said plainly)', again);
  check(deploys.length === before, '(j) no second deploy');
}

// (k) token omitted: nothing launches until the ticker is confirmed; launch_token uses the proposal.
{
  const before = deploys.length;
  const r = await submit({ project: project('Kappa Launch'), confirmed: true, wallet: null });
  check(r.token.status === 'skipped' && /pass token/i.test(r.token.agent_note ?? ''), '(k) token omitted → skipped, "pass token"', r.token);
  check(deploys.length === before, '(k) no deploy sent');
  const saved = await row(r.project_id);
  check(saved.token_symbol === 'KAPPA' && saved.token_url === null, '(k) proposal stored for later', saved);
  // Ruling 28 (final I1): the entry has no wallet of its own, and launch_token never falls back to
  // the installation's remembered one: it asks for creator_wallet, and nothing deploys.
  const noWallet = await launch({ project_id: r.project_id });
  check(noWallet.status === 'failed' && /no wallet for the token's fees/.test(noWallet.note ?? '') && /creator_wallet/.test(noWallet.agent_note ?? '') && deploys.length === before, '(k) launch_token without a wallet → failed, never the remembered wallet', noWallet);
  const l = await launch({ project_id: r.project_id, creator_wallet: WALLET });
  check(l.status === 'launched' && l.symbol === 'KAPPA', '(k) launch_token with the builder\'s wallet launches the stored proposal', l);
}

// (l) tokens.fun unsure (502): pending, the claim kept.
{
  const r = await submit({ project: project('Unknown Case'), token: { name: 'Unknown Case', symbol: 'UNKN6' }, confirmed: true });
  check(r.token.status === 'pending' && r.token.note === LAUNCH_STUCK && /502/.test(r.token.agent_note ?? ''), '(l) 502 → pending', r.token);
  const saved = await row(r.project_id);
  check(saved.token_url === 'pending', '(l) claim kept (token_url = pending)', saved);
  const before = deploys.length;
  const again = await launch({ project_id: r.project_id, symbol: 'UNKN7' });
  check(again.status === 'pending' && again.note === LAUNCH_STUCK, '(l) later launch_token is refused', again);
  check(deploys.length === before, '(l) no second deploy');
}

// (m) a project that already has a token.
{
  const existing = 'https://tokens.fun/coin/0x' + 'ef'.repeat(20);
  const before = deploys.length;
  const r = await submit({ project: project('Has Token', { token_url: existing }), token: { name: 'Has Token', symbol: 'HAST' }, confirmed: true });
  check(r.token.status === 'skipped' && r.token.note?.includes(`already has a token: ${existing}`), '(m) existing token → skipped at submission', r.token);
  const saved = await row(r.project_id);
  check(saved.token_url === existing, '(m) existing token_url untouched', saved);
  const again = await launch({ project_id: aProjectId });
  check(again.status === 'failed' && /already has a token/.test(again.note ?? ''), '(m) launch_token on a launched project → failed', again);
  check(deploys.length === before, '(m) no deploy sent');
}

// (n) ownership: no earnkit.txt.
{
  const before = deploys.length;
  const p = project('Not Mine', {}, 'noproof-');
  const r = await submit({ project: p, token: { name: 'Not Mine', symbol: 'NOTMN' }, confirmed: true });
  check(
    r.token.status === 'gate_failed' &&
      r.token.note === "I need to add a short proof line to your repo first, then say 'launch the token'." &&
      r.token.agent_note?.includes(`"${lineFor(inst.id, p.repo_url)}"`) === true &&
      !/payout_wallet/.test(r.token.agent_note) &&
      !/\b(add|edit|create) (a |the )?file\b|\bpush it\b|earnkit\.txt|token:/i.test(r.token.note),
    '(n) no earnkit.txt → gate_failed: plain words for the builder, the one line in the agent note',
    r.token,
  );
  check(deploys.length === before, '(n) no deploy sent');
}

// (o) one token per repo: a second entry of (a)'s repo (e.g. a retried record_submission).
{
  const before = deploys.length;
  // v2.6 Ruling 23 (I1): the same agent recording the same repo again updates its entry: same id,
  // its coin kept, nothing launched.
  const retry = await submit({ project: project('Chain Kit Builder', { repo_url: aRepo }), token: { name: 'Chain Kit Again', symbol: 'CHAN2' }, confirmed: true });
  check(
    retry.recorded === true && retry.project_id === aProjectId && retry.token.status === 'launched' &&
      retry.token.tokens_fun === `https://tokens.fun/coin/${TOKEN_ADDRESS}`,
    '(o) the same agent re-recording the repo updates its entry, coin kept',
    retry,
  );
  // Another agent of the builder entering the same repo: a second entry, never a second token.
  const other = await newInstallation();
  OWNERS.add(other.id);
  const otherCtx: Ctx = { installationId: other.id, tokenDeps: { gate: passGate, limit: async () => {} } };
  const r = await submit({ project: project('Chain Kit Builder', { repo_url: aRepo }), token: { name: 'Chain Kit Again', symbol: 'CHAN2' }, confirmed: true }, undefined, otherCtx);
  check(r.recorded === true && r.project_id !== aProjectId && r.token.status === 'skipped' && r.token.note === `This repo already has a token: https://tokens.fun/coin/${TOKEN_ADDRESS}`, '(o) second entry of the repo → skipped', r.token);
  const l = (await tools.launch_token({ builder_confirmed: true, project_id: r.project_id }, otherCtx)) as TokenOutcome;
  check(l.status === 'failed' && /This repo already has a token/.test(l.note ?? ''), '(o) launch_token on it → failed', l);
  check(deploys.length === before, '(o) no deploy sent');
  // The database refuses a second claim on the repo even past the app check.
  const dup = await db`UPDATE projects SET token_url = 'pending', token_repo_key = ${aRepo.replace('https://', '')} WHERE id = ${r.project_id}`.catch((e: { constraint_name?: string }) => e.constraint_name);
  check(dup === 'projects_token_repo_key', '(o) the unique index refuses a second token on the repo', dup);
}

// (p) v2.8.1 §A4: the per-wallet limit: 10 launches a UTC day across agents, the real counter (a
// fresh wallet; two fresh agents, so the per-agent 10 isn't what stops it).
{
  const agents = [await newInstallation(), await newInstallation()];
  for (const a of agents) OWNERS.add(a.id);
  const ctxOf = (i: number): Ctx => ({ installationId: agents[i].id, tokenDeps: { gate: passGate } });
  const wallet = '0x' + [...Array(40)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const before = deploys.length;
  const results: TokenOutcome[] = [];
  const syms = ['LIMA', 'LIMB', 'LIMC', 'LIMD', 'LIME', 'LIMF', 'LIMG', 'LIMH', 'LIMI', 'LIMJ', 'LIMK'];
  for (const [n, sym] of syms.entries())
    results.push((await submit({ project: project(`Limit ${sym}`), token: { name: `Limit ${sym}`, symbol: sym }, confirmed: true, wallet }, undefined, ctxOf(n < 6 ? 0 : 1))).token);
  check(results.slice(0, 10).every((t) => t.status === 'launched'), '(p) ten launches go through', results);
  check(
    results[10].status === 'failed' &&
      results[10].note === "Your token didn't launch: this wallet reached today's launch limit of 10. Try again after 00:00 UTC.",
    '(p) the eleventh is failed (daily wallet limit) and says when to retry',
    results[10],
  );
  check(deploys.length === before + 10, '(p) only ten deploys sent');
}

// (q) no deploy key: nothing is offered, checked or sent.
{
  const saved = process.env.TOKENSFUN_DEPLOY_API_KEY;
  delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  const before = deploys.length;
  const reads = ownershipReads.length;
  try {
    const prep = (await tools.prepare_submission({ program_id: ON, project: { name: 'Keyless App' } }, ctx())) as Record<string, unknown>;
    check(!('token' in prep), '(q) no key: prepare_submission has no token block');
    const r = await submit({ project: project('Keyless App'), token: { name: 'Keyless App', symbol: 'KEYL' }, confirmed: true });
    check(r.recorded === true && r.token.status === 'skipped' && r.token.note === "Token launches aren't available right now.", '(q) no key → skipped', r.token);
    check(deploys.length === before && ownershipReads.length === reads, '(q) nothing checked or sent');
  } finally {
    process.env.TOKENSFUN_DEPLOY_API_KEY = saved;
  }
}

// (r) through the MCP server: token.proposed echoed verbatim, image and all.
{
  const server = createMcpServer(ctx());
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'e2e', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
  const p = project('Echo Proposal');
  const prep = JSON.parse(text(await client.callTool({ name: 'prepare_submission', arguments: { program_id: ON, project: { name: p.name } } })));
  check(prep.token?.proposed?.image === 'mark', '(r) token.proposed has image (v2.10: the generated mark, with no live link)', prep.token);
  const res = await client.callTool({
    name: 'record_submission',
    // Ruling 30: the agent echoes the proposal and the shown wallet.
    arguments: { program_id: ON, project: p, submission_data: { notes: 'e2e' }, token: prep.token.proposed, payout_wallet: prep.shown_wallet, builder_confirmed: true },
  });
  const out = JSON.parse(text(res)) as Recorded;
  check(!res.isError && out.token.status === 'launched' && out.token.symbol === prep.token.proposed.symbol, '(r) echoed proposal launches through MCP', text(res));
  await client.close();
}

// (s) earnkit.txt without the token line (a payout_wallet line only).
{
  const before = deploys.length;
  const p = project('No Token Line', {}, 'notoken-');
  const r = await submit({ project: p, token: { name: 'No Token Line', symbol: 'NOTOK' }, confirmed: true });
  check(
    r.token.status === 'gate_failed' &&
      r.token.note === "I need to add a short proof line to your repo first, then say 'launch the token'." &&
      // v2.8.1 §A3: exactly what was found, then the line and where it goes.
      r.token.agent_note === `earnkit.txt on the default branch has no token line. Write the line "${lineFor(inst.id, p.repo_url)}" to earnkit.txt at the root of ${p.repo_url.replace(/^https:\/\//, '')} on the default branch and push it yourself; never ask the builder to edit files. Then call launch_token.`,
    '(s) no token line → gate_failed with the line to add',
    r.token,
  );
  check(deploys.length === before, '(s) no deploy sent');
}

// (t) someone else's repo: its file carries the line for their agent, never this one.
{
  const before = deploys.length;
  const p = project('Not My Project', {}, 'victim-');
  const r = await submit({
    project: p,
    token: { name: 'Not My Project', symbol: 'STEAL', creator_wallet: VICTIM_WALLET },
    confirmed: true,
  });
  check(
    r.token.status === 'gate_failed' &&
      r.token.agent_note?.includes(`"${lineFor(inst.id, p.repo_url)}"`) === true &&
      !r.token.agent_note.includes(lineFor(VICTIM_AGENT, p.repo_url)!),
    "(t) the line for another agent is refused (its wallet doesn't help)",
    r.token,
  );
  check(deploys.length === before, '(t) no deploy sent');
}

// (u) the repo link changes between the gate and the claim (as a concurrent launch_token would).
{
  const before = deploys.length;
  const p = project('Race Case');
  const swapped = 'https://github.com/someone-else/their-repo';
  const raceGate: GateDeps = {
    ...passGate,
    // The gate's last step: by now the repo and its earnkit.txt were checked for p's repo.
    screen: async () => {
      await db`UPDATE projects SET repo_url = ${swapped} WHERE repo_url = ${p.repo_url}`;
    },
  };
  const r = await submit({ project: p, token: { name: 'Race Case', symbol: 'RACE' }, confirmed: true }, raceGate);
  check(r.token.status === 'failed' && r.token.note === LINKS_CHANGED, '(u) links changed → failed', r.token);
  check(deploys.length === before, '(u) no deploy sent');
  const saved = await row(r.project_id);
  check(saved.token_url === null && saved.token_repo_key === null, '(u) nothing claimed for the swapped repo', saved);
}

// (v) a third party copies the owner's whole token line from the public earnkit.txt.
{
  // The owner's own agent (fresh, so the main agent's 20-a-day record_submission limit is unaffected).
  const owner = await newInstallation();
  OWNERS.add(owner.id);
  const ownerCtx: Ctx = { installationId: owner.id, tokenDeps: { gate: passGate, limit: async () => {} } };
  const thief = await newInstallation(); // not in OWNERS: the file has only the owners' lines
  const shared = project('Shared Repo', {}, 'shared-');
  const ownerLine = lineFor(owner.id, shared.repo_url)!;
  const before = deploys.length;
  const stolen = await submit(
    { project: shared, token: { name: 'Shared Repo', symbol: 'OWNR', creator_wallet: WALLET }, confirmed: true },
    undefined,
    { installationId: thief.id, tokenDeps: { gate: passGate, limit: async () => {} } },
  );
  const thiefLine = lineFor(thief.id, shared.repo_url)!;
  check(
    stolen.token.status === 'gate_failed' &&
      stolen.token.note === "I need to add a short proof line to your repo first, then say 'launch the token'." &&
      stolen.token.agent_note?.includes(`"${thiefLine}"`) === true,
    "(v) the owner's line is refused for a third party's agent",
    stolen.token,
  );
  check(!stolen.token.note?.includes(ownerLine), "(v) the refusal never shows the owner's line");
  check(deploys.length === before, '(v) no deploy for the third party');
  // prepare_submission shows the owner's agent its own line for this repo (any ticker).
  const prep = (await tools.prepare_submission(
    { program_id: ON, project: { name: 'Owner Repo', repo_url: shared.repo_url } },
    ownerCtx,
  )) as { token_line?: string };
  check(prep.token_line === ownerLine, '(v) prepare_submission gives the agent its own line', prep);
  const mine = await submit(
    { project: { ...shared, name: 'Shared Repo' }, token: { name: 'Shared Repo', symbol: 'OWNR' }, confirmed: true },
    undefined,
    ownerCtx,
  );
  check(mine.token.status === 'launched' && mine.token.symbol === 'OWNR', "(v) the owner's own launch with that line succeeds", mine.token);
}

// (w) v2.8 Part C: the confirmation step. The token launches on "yes" and the submit kit comes only
// from confirm_entry; "skip" is no token, no builder bonus.
{
  const agent = await newInstallation();
  OWNERS.add(agent.id);
  const c: Ctx = { installationId: agent.id, tokenDeps: { gate: passGate, limit: async () => {} } };
  type Confirmed = { show_to_builder: string; project_id?: number; token?: TokenOutcome; kit?: { mode: string; show_to_builder: string }; shown_wallet?: string };
  const confirm = (a: Record<string, unknown>, cc: Ctx = c) =>
    tools.confirm_entry({ program_id: ON, answers: { notes: 'e2e' }, ...a }, cc) as Promise<Confirmed>;
  const yes = { builder_confirmed: true, decision: 'go' };

  // The offer: no entry, no kit; the remembered wallet is shown, and comes back as shown_wallet.
  const p = project('Confirm Kit');
  const before = deploys.length;
  const offer = await confirm({ project: p });
  check(offer.show_to_builder.startsWith('Want the builder bonus? It comes with a token.\n') && !('kit' in offer) && offer.shown_wallet === WALLET, '(w) offer only before the yes', offer);
  // Yes, echoing the shown wallet: launched through the mock, the kit returned.
  const r = await confirm({ project: p, ...yes, wallet: offer.shown_wallet });
  check(r.token?.status === 'launched' && deploys.length === before + 1 && lastDeploy().creatorWallet === WALLET, '(w) yes launches the token to the shown wallet', r);
  check(
    r.kit?.mode === 'copy_paste' &&
      // Final review M8: the post-launch line names the ticker.
      r.show_to_builder.startsWith(`Your token $${r.token?.symbol} is live: tokens.fun/coin/${TOKEN_ADDRESS}.\n\nReady for Token e2e (encouraged).`) &&
      /^[A-Z0-9]+$/.test(r.token?.symbol ?? '') &&
      r.show_to_builder.endsWith('After you submit, send me the confirmation screenshot or email.'),
    '(w) the kit comes with the token line',
    r,
  );
  const saved = await db<{ confirm_choice: string; confirmed_at: Date | null; token_url: string }[]>`
    SELECT confirm_choice, confirmed_at, token_url FROM projects WHERE id = ${r.project_id!}`;
  check(saved[0].confirm_choice === 'go' && saved[0].confirmed_at !== null && saved[0].token_url === `https://tokens.fun/coin/${TOKEN_ADDRESS}`, '(w) the entry row: go, confirmed, its token', saved);
  // Yes again: same entry, no second deploy, the kit again.
  const again = await confirm({ project: p, ...yes, wallet: WALLET });
  check(again.project_id === r.project_id && deploys.length === before + 1 && again.kit !== undefined, '(w) a second yes launches nothing', again);
  // The builder submitted: record_submission updates that entry, no token flow.
  const rec = (await tools.record_submission(
    { program_id: ON, project: p, submission_data: { notes: 'e2e' }, payout_wallet: WALLET, builder_submitted: true },
    c,
  )) as Recorded;
  check(rec.project_id === r.project_id && rec.token.status === 'launched' && deploys.length === before + 1, '(w) record_submission updates the confirmed entry', rec);

  // Skip: the kit, no token, nothing checked or sent.
  const reads = ownershipReads.length;
  const sk = await confirm({ project: project('Confirm Skip'), builder_confirmed: true, decision: 'skip' });
  check(sk.kit !== undefined && !sk.token && sk.show_to_builder.startsWith('No token, no builder bonus.\n\n') && deploys.length === before + 1 && ownershipReads.length === reads, '(w) skip: the kit, no token', sk);

  // No wallet passed back: no deploy, no kit (the remembered wallet is never used unseen).
  const nw = await confirm({ project: project('Confirm No Wallet'), ...yes });
  check(nw.token?.fixable === true && !nw.kit && nw.shown_wallet === WALLET && deploys.length === before + 1, '(w) no wallet passed: fixable, no kit, no deploy', nw);

  // v2.8.1 fix round 1: the agent asks for a taken ticker (CKB): never launched or shown; a new Yes
  // line with the next suggestion, no kit; yes to that launches exactly it.
  const tk = project('Confirm Taken');
  const taken = (await confirm({ project: tk, ...yes, wallet: WALLET, token: { symbol: 'CKB' } })) as Confirmed & { token?: { proposed?: { name: string; symbol: string } } };
  const next = taken.token?.proposed;
  check(
    taken.token?.fixable === true && !taken.kit && next !== undefined && next.symbol !== 'CKB' &&
      taken.show_to_builder.startsWith(`$CKB is taken.\nWant the builder bonus?`) &&
      taken.show_to_builder.includes(`\nYes: launches $${next.symbol} (Confirm Taken) on Base.`) && deploys.length === before + 1,
    '(w) taken ticker: a new Yes line, no kit, no deploy',
    taken,
  );
  const takenAgain = await confirm({ project: tk, ...yes, wallet: WALLET, token: next });
  check(takenAgain.token?.status === 'launched' && takenAgain.token.symbol === next?.symbol && takenAgain.kit !== undefined, '(w) yes to it launches exactly that', takenAgain);

  // The proof line not pushed yet: fixable (say go); pushed, yes again launches.
  const late = project('Confirm Late', {}, 'late-');
  await confirm({ project: late }); // the offer the builder said yes to
  const nl = await confirm({ project: late, ...yes, wallet: WALLET });
  check(nl.token?.fixable === true && !nl.kit && nl.show_to_builder === 'I need to add a short proof line to your repo first, then say go.', '(w) proof line missing: fixable, no kit', nl);
  pushed.add(late.repo_url.split('/').pop()!);
  const pushedOk = await confirm({ project: late, ...yes, wallet: WALLET });
  check(pushedOk.token?.status === 'launched' && pushedOk.kit !== undefined, '(w) after the push, yes launches', pushedOk);

  // An agent that can't push: nothing checked or sent, the kit with the one line.
  const reads2 = ownershipReads.length;
  const deploys2 = deploys.length;
  const np = await confirm({ project: project('Confirm No Push'), ...yes, wallet: WALLET, agent: { can_push: false } });
  check(np.kit !== undefined && np.show_to_builder.startsWith('To launch your token, open this in Claude Code or Cursor.\n\n') && deploys.length === deploys2 && ownershipReads.length === reads2, "(w) can't push: the kit, no launch", np);
}

// (x) v2.8.1 §A: the token launch is never stuck, names itself, says when to retry, and replies in time.
{
  const agent = await newInstallation();
  OWNERS.add(agent.id);
  const c: Ctx = { installationId: agent.id, tokenDeps: { gate: passGate, limit: async () => {} } };
  type Confirmed = { show_to_builder: string; token?: TokenOutcome; kit?: unknown; agent_note?: string };
  const confirm = (a: Record<string, unknown>) =>
    tools.confirm_entry({ program_id: ON, answers: { notes: 'e2e' }, ...a }, c) as Promise<Confirmed>;
  const yes = { builder_confirmed: true, decision: 'go', wallet: WALLET };
  // The offer (with the builder's own token, stored as shown), then their yes to it.
  const offerThenGo = async (p: Record<string, string>, token: { name: string; symbol: string }) => {
    await confirm({ project: p, token });
    return confirm({ project: p, ...yes, token });
  };

  // §A2: the offer names the token that launches.
  const offer = await confirm({ project: project('Busy Alpha') });
  check(/\nYes: launches \$BUSY \(Busy Alpha\) on Base\. You earn 40% of its trading fees, plus a shot at the builder bonus\.\n/.test(offer.show_to_builder), '(x) the Yes line names $TICKER (Name)', offer);

  // §A1: one 503 "Pending transactions", then it deploys: one automatic retry.
  const before = deploys.length;
  const a = await offerThenGo(project('Busy Alpha'), { name: 'Busy Alpha', symbol: 'BUSYA' });
  check(a.token?.status === 'launched' && deploys.length === before + 2 && a.kit !== undefined, '(x) a 503 before minting is retried once and launches', a);

  // §A1: nothing minted twice: released, "say go", the kit; go again launches.
  const bp = project('Busy Beta');
  const b = await offerThenGo(bp, { name: 'Busy Beta', symbol: 'BUSYB' });
  check(
    b.token?.status === 'failed' && b.show_to_builder.startsWith("Your token didn't launch yet; say go to try again.\n\n") && b.kit !== undefined && deploys.length === before + 4,
    '(x) released after the retry: the builder says go',
    b,
  );
  const bRow = await db<{ token_url: string | null }[]>`SELECT token_url FROM projects WHERE installation_id = ${agent.id} AND name = 'Busy Beta'`;
  check(bRow[0]?.token_url === null, '(x) the claim is released', bRow);
  const b2 = await confirm({ project: bp, ...yes, token: { name: 'Busy Beta', symbol: 'BUSYB' } });
  check(b2.token?.status === 'launched' && deploys.length === before + 5, '(x) go again launches', b2);

  // §A4: tokens.fun's wallet limit: when to retry, from its retry_after.
  const l = await offerThenGo(project('Limit Wallet'), { name: 'Limit Wallet', symbol: 'LIMW' });
  check(
    l.show_to_builder.startsWith(`Your token didn't launch: this wallet reached today's launch limit. Try again after ${LIMIT_AT.toISOString().slice(11, 16)} UTC.\n\n`) && l.kit !== undefined,
    '(x) the wallet limit says "Try again after HH:MM UTC"',
    l,
  );

  // §A5: a deploy slower than the reply time: "launching", no kit; then the token and the kit.
  process.env.EARNKIT_LAUNCH_REPLY_MS = '500';
  const sp = project('Slow Gamma');
  const t0 = Date.now();
  await confirm({ project: sp, token: { name: 'Slow Gamma', symbol: 'SLOW' } });
  const s1 = await confirm({ project: sp, ...yes, token: { name: 'Slow Gamma', symbol: 'SLOW' } });
  const took = Date.now() - t0;
  delete process.env.EARNKIT_LAUNCH_REPLY_MS;
  check(s1.show_to_builder === 'Your token is launching. Ask me again in a minute for its link.' && s1.kit === undefined && took < 1_400, `(x) slow deploy: "launching" in ${took} ms, no kit`, s1);
  await new Promise((r) => setTimeout(r, 1_800));
  const s2 = await confirm({ project: sp, ...yes, token: { name: 'Slow Gamma', symbol: 'SLOW' }, check_back: true });
  check(s2.token?.status === 'launched' && s2.kit !== undefined && deploys.filter((d) => d.symbol === 'SLOW').length === 1, '(x) the next call returns the token and the kit, one deploy', s2);
}

check(authFailures === 0, 'every mock call carried the deploy key');

for (const req of hanging) req.socket.destroy();
server.closeAllConnections();
server.close();
await db.end();
console.log(`token e2e: ${checks} checks passed`);
