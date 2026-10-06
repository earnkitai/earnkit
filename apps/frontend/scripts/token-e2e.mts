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

const { sql } = await import('../lib/earnkit/db');
const { upsertProgram } = await import('../lib/earnkit/programs');
const { ProgramFile } = await import('../lib/earnkit/program-file');
const { tools } = await import('../lib/earnkit/tools');
const { createMcpServer } = await import('../lib/earnkit/mcp');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { LINKS_CHANGED } = await import('../lib/earnkit/tokens');
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
    live_url: `https://token-e2e-${seq}.example.com`,
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
    token?: { proposed: { name: string; symbol: string } | null; say_to_builder: string; creator_wallet: string | null };
    shown_wallet?: string;
  };
  // Ruling 30: the wallet on the line comes back as a field to echo.
  check(prep.shown_wallet === WALLET, '(a) shown_wallet is the wallet on the wallet line', prep);
  // The agent omits it: recorded with no coin; the remembered wallet is never read at record time.
  {
    const before = deploys.length;
    const none = (await submit({ project: project('No Wallet Echo'), token: { name: 'No Wallet Echo', symbol: 'NOECH' }, confirmed: true, wallet: null })) as Recorded & { show_to_builder?: string };
    check(
      none.recorded === true && none.token.status === 'skipped' && none.token.no_wallet === true && deploys.length === before &&
        /Reply with a wallet to get your coin/.test(none.show_to_builder ?? ''),
      '(a) no wallet passed back → recorded, no coin, the plain no-wallet line',
      none,
    );
  }
  check(prep.token?.proposed?.symbol === 'CHAIN', '(a) proposed ticker is CHAIN (CKB is taken)', prep.token);
  // v2.6 Ruling 7: an active non-campaign program has the builder bonus, so the skip names it.
  check(
    prep.token?.say_to_builder.startsWith('Your entry gets a token on Base, Chain Kit Builder ($CHAIN):') &&
      prep.token.say_to_builder.includes('· say skip for no token (and no builder bonus)'),
    '(a) say_to_builder: a token on Base, its name, and the skip (no token, no builder bonus)',
    prep.token,
  );
  // v2.6 §3: the remembered wallet is prefilled on the wallet line (one yes confirms both).
  check(prep.token?.say_to_builder.includes('(used last time) — or tell me another.'), '(a) say_to_builder prefills the remembered wallet', prep.token);
  check(prep.token?.creator_wallet === WALLET, '(a) creator wallet is the remembered wallet');
  const before = deploys.length;
  const r = await submit({ project: p, token: { name: prep.token!.proposed!.name, symbol: 'CHAIN' }, confirmed: true });
  check(r.recorded === true, '(a) submission recorded');
  check(r.token.status === 'launched' && r.token.symbol === 'CHAIN', '(a) token launched as CHAIN', r.token);
  check(r.token.tokens_fun === `https://tokens.fun/coin/${TOKEN_ADDRESS}`, '(a) tokens.fun page returned');
  const body = lastDeploy();
  check(deploys.length === before + 1, '(a) one deploy sent');
  check(body.creatorWallet === WALLET, '(a) mock saw the creator wallet', body);
  check(typeof body.imageUrl === 'string' && body.imageUrl.endsWith(`/api/projects/${r.project_id}/token-image?s=CHAIN`), '(a) image is the monogram route, with the ticker', body.imageUrl);
  check(ownershipReads.includes(p.repo_url.split('/').pop()!), '(a) earnkit.txt was read');
  check(!('twitter' in body), '(a) no twitter field');
  check(body.chainId === 8453 && body.source === 'earnkit', '(a) Base chain, source earnkit');
  const saved = await row(r.project_id);
  check(saved.token_url === `https://tokens.fun/coin/${TOKEN_ADDRESS}` && saved.token_status === 'launched', '(a) project row has the token', saved);
  check(saved.token_repo_key === p.repo_url.replace('https://', ''), '(a) token_repo_key is the normalized repo', saved);
  // Ruling 22: the full fee wallet once, on the wallet line; the short fee line and both terms links.
  check(
    prep.token?.say_to_builder.includes(`Wallet for fees and any bonus: ${WALLET} (used last time)`) &&
      prep.token.say_to_builder.split(WALLET).length === 2 &&
      prep.token.say_to_builder.includes('Fees in WETH; tokens.fun pays gas.') &&
      !/clanker/i.test(prep.token.say_to_builder) &&
      prep.token.say_to_builder.includes('risk-disclosure'),
    '(a) say_to_builder names the fee wallet once and carries the fee line and terms',
    prep.token,
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
  check(again.status === 'failed' && /in progress or unconfirmed/.test(again.note ?? ''), '(j) later launch_token is refused', again);
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
  check(noWallet.status === 'failed' && /no wallet for the coin's fees/.test(noWallet.note ?? '') && /creator_wallet/.test(noWallet.agent_note ?? '') && deploys.length === before, '(k) launch_token without a wallet → failed, never the remembered wallet', noWallet);
  const l = await launch({ project_id: r.project_id, creator_wallet: WALLET });
  check(l.status === 'launched' && l.symbol === 'KAPPA', '(k) launch_token with the builder\'s wallet launches the stored proposal', l);
}

// (l) tokens.fun unsure (502): pending, the claim kept.
{
  const r = await submit({ project: project('Unknown Case'), token: { name: 'Unknown Case', symbol: 'UNKN6' }, confirmed: true });
  check(r.token.status === 'pending' && /502/.test(r.token.note ?? ''), '(l) 502 → pending', r.token);
  const saved = await row(r.project_id);
  check(saved.token_url === 'pending', '(l) claim kept (token_url = pending)', saved);
  const before = deploys.length;
  const again = await launch({ project_id: r.project_id, symbol: 'UNKN7' });
  check(again.status === 'failed' && /in progress or unconfirmed/.test(again.note ?? ''), '(l) later launch_token is refused', again);
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

// (p) the per-installation limit: 3 launches a day, the real counter.
{
  const fresh = await newInstallation();
  OWNERS.add(fresh.id);
  const c: Ctx = { installationId: fresh.id, tokenDeps: { gate: passGate } };
  const before = deploys.length;
  const results: TokenOutcome[] = [];
  for (const sym of ['LIMA', 'LIMB', 'LIMC', 'LIMD'])
    results.push((await submit({ project: project(`Limit ${sym}`), token: { name: `Limit ${sym}`, symbol: sym }, confirmed: true }, undefined, c)).token);
  check(results.slice(0, 3).every((t) => t.status === 'launched'), '(p) three launches go through', results);
  check(results[3].status === 'failed' && /^This agent has launched 3 tokens today, the daily limit\./.test(results[3].note ?? ''), '(p) the fourth is failed (daily limit)', results[3]);
  check(deploys.length === before + 3, '(p) only three deploys sent');
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
  check(prep.token?.proposed?.image === 'monogram', '(r) token.proposed has image', prep.token);
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
      r.token.agent_note === `Write earnkit.txt at the root of ${p.repo_url.replace(/^https:\/\//, '')} (default branch) with the line "${lineFor(inst.id, p.repo_url)}" and push it yourself; never ask the builder to edit files. Then call launch_token.`,
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
  )) as { token?: { note: string } };
  check(prep.token?.note.includes(`Write the line "${ownerLine}"`) === true, '(v) prepare_submission gives the agent its own line', prep.token);
  const mine = await submit(
    { project: { ...shared, name: 'Shared Repo' }, token: { name: 'Shared Repo', symbol: 'OWNR' }, confirmed: true },
    undefined,
    ownerCtx,
  );
  check(mine.token.status === 'launched' && mine.token.symbol === 'OWNR', "(v) the owner's own launch with that line succeeds", mine.token);
}

check(authFailures === 0, 'every mock call carried the deploy key');

for (const req of hanging) req.socket.destroy();
server.closeAllConnections();
server.close();
await db.end();
console.log(`token e2e: ${checks} checks passed`);
