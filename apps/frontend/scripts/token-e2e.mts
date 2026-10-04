import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * v2.3 token at submission, end to end against a local Postgres and a mock tokens.fun:
 *   DATABASE_URL=postgres://postgres@127.0.0.1:<port>/postgres?sslmode=disable \
 *   TOKENSFUN_API_URL=http://127.0.0.1:0 pnpm token:e2e
 * Port 0 picks a free port for the mock. TOKENSFUN_DEPLOY_API_KEY defaults to a dummy value; it
 * only ever reaches the mock. The gate's GitHub, live-link and sanctions checks are faked through
 * ToolContext.tokenDeps, so nothing touches a real network and no real token is launched.
 *
 * Flows (all through the `tools` layer, with the real database store):
 *   a. default: proposal CHAIN (CKB is taken), confirmed ticker passed back → launched
 *   b. an edited ticker launches as given
 *   c. token: 'skip' → skipped, no deploy
 *   d. gate failures: live link 404, a fork, no live link → gate_failed
 *   e. a program with token_policy 'off' → skipped, and prepare_submission has no token block
 *   f. launch_token retries (d)'s 404 project with the stored ticker → launched
 *   g. tokens.fun refuses (400) → failed, claim released; launch_token with another ticker launches
 *   h. no builder_confirmed → skipped
 *   i. the monogram route draws a PNG
 *   j. no answer (timeout) → pending, claim kept; launch_token is refused
 *   k. token omitted → skipped ("pass token"); launch_token launches the stored proposal
 *   l. a 502 "Deployment status unknown" → pending, claim kept; launch_token is refused
 *   m. a project that already has a token → skipped at submission, failed via launch_token
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
const KEY = process.env.TOKENSFUN_DEPLOY_API_KEY;
delete process.env.EARNKIT_TOKENSFUN_TIMEOUT_MS;

// ---- the mock tokens.fun ----
const TOKEN_ADDRESS = '0x' + 'ab'.repeat(20);
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

const { sql } = await import('../lib/earnkit/db');
const { upsertProgram } = await import('../lib/earnkit/programs');
const { ProgramFile } = await import('../lib/earnkit/program-file');
const { tools } = await import('../lib/earnkit/tools');
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
const WALLET = '0x' + '12'.repeat(20);
const [inst] = await db<{ id: number }[]>`
  INSERT INTO installations (token_hash, payout_wallet)
  VALUES (${'e2e-token-' + Date.now()}, ${WALLET}) RETURNING id`;

// ---- helpers ----
const passGate: GateDeps = {
  repo: async () => ({ fork: false, hasCommits: true }),
  probe: async () => {},
  screen: async () => {},
};
const ctx = (gate: GateDeps = passGate): Ctx => ({ installationId: inst.id, tokenDeps: { gate } });
let seq = 0;
const project = (name: string, extra: Record<string, string> = {}) => {
  seq++;
  return {
    name,
    repo_url: `https://github.com/e2e-builder/token-e2e-${Date.now()}-${seq}`,
    live_url: `https://token-e2e-${seq}.example.com`,
    ...extra,
  };
};
type Recorded = { recorded: boolean; project_id: number; token: TokenOutcome };
const submit = async (
  a: { program?: string; project: Record<string, string>; token?: unknown; confirmed?: boolean },
  gate?: GateDeps,
) =>
  (await tools.record_submission(
    {
      program_id: a.program ?? ON,
      project: a.project,
      submission_data: { notes: 'e2e' },
      ...(a.token !== undefined && { token: a.token }),
      ...(a.confirmed !== undefined && { builder_confirmed: a.confirmed }),
    },
    ctx(gate),
  )) as Recorded;
const launch = (input: Record<string, unknown>, gate?: GateDeps) =>
  tools.launch_token({ builder_confirmed: true, ...input }, ctx(gate)) as Promise<TokenOutcome>;
const row = async (id: number) =>
  (
    await db<
      { token_url: string | null; token_status: string | null; token_symbol: string | null; token_name: string | null }[]
    >`SELECT token_url, token_status, token_symbol, token_name FROM projects WHERE id = ${id}`
  )[0];
const lastDeploy = () => deploys[deploys.length - 1];

// (a) default: the proposal, confirmed and passed back.
let aProjectId = 0;
{
  const p = project('Chain Kit Builder');
  const prep = (await tools.prepare_submission({ program_id: ON, project: { name: p.name } }, ctx())) as {
    token?: { proposed: { name: string; symbol: string } | null; say_to_builder: string; creator_wallet: string | null };
  };
  check(prep.token?.proposed?.symbol === 'CHAIN', '(a) proposed ticker is CHAIN (CKB is taken)', prep.token);
  check(prep.token?.say_to_builder.includes('no token'), '(a) say_to_builder offers "no token"');
  check(prep.token?.creator_wallet === WALLET, '(a) creator wallet is the remembered wallet');
  const before = deploys.length;
  const r = await submit({ project: p, token: { name: prep.token!.proposed!.name, symbol: 'CHAIN' }, confirmed: true });
  check(r.recorded === true, '(a) submission recorded');
  check(r.token.status === 'launched' && r.token.symbol === 'CHAIN', '(a) token launched as CHAIN', r.token);
  check(r.token.tokens_fun === `https://tokens.fun/coin/${TOKEN_ADDRESS}`, '(a) tokens.fun page returned');
  const body = lastDeploy();
  check(deploys.length === before + 1, '(a) one deploy sent');
  check(body.creatorWallet === WALLET, '(a) mock saw the creator wallet', body);
  check(typeof body.imageUrl === 'string' && body.imageUrl.endsWith(`/api/projects/${r.project_id}/token-image`), '(a) image is the monogram route', body.imageUrl);
  check(!('twitter' in body), '(a) no twitter field');
  check(body.chainId === 8453 && body.source === 'earnkit', '(a) Base chain, source earnkit');
  const saved = await row(r.project_id);
  check(saved.token_url === `https://tokens.fun/coin/${TOKEN_ADDRESS}` && saved.token_status === 'launched', '(a) project row has the token', saved);
  aProjectId = r.project_id;
}

// (b) an edited ticker.
{
  const r = await submit({ project: project('Kit Studio'), token: { name: 'Kit Studio', symbol: 'KITS' }, confirmed: true });
  check(r.token.status === 'launched' && r.token.symbol === 'KITS', '(b) edited ticker launches as KITS', r.token);
  check(lastDeploy().symbol === 'KITS', '(b) mock saw KITS');
}

// (c) the builder said no token.
{
  const before = deploys.length;
  const r = await submit({ project: project('No Token App'), token: 'skip', confirmed: true });
  check(r.token.status === 'skipped', '(c) token skipped', r.token);
  check(deploys.length === before, '(c) no deploy sent');
}

// (d) gate failures.
let retryProjectId = 0;
{
  const before = deploys.length;
  const r404 = await submit(
    { project: project('Retry Demo'), token: { name: 'Retry Demo', symbol: 'RETRY' }, confirmed: true },
    { ...passGate, probe: async () => { throw new Error('answered 404, not 2xx'); } },
  );
  check(r404.token.status === 'gate_failed' && /live link/.test(r404.token.note ?? ''), '(d) live link 404 → gate_failed', r404.token);
  retryProjectId = r404.project_id;
  const fork = await submit(
    { project: project('Forked Thing'), token: { name: 'Forked Thing', symbol: 'FORKD' }, confirmed: true },
    { ...passGate, repo: async () => ({ fork: true, hasCommits: true }) },
  );
  check(fork.token.status === 'gate_failed' && /fork/.test(fork.token.note ?? ''), '(d) fork → gate_failed', fork.token);
  const { live_url: _l, ...noLive } = project('Offline App');
  const nl = await submit({ project: noLive, token: { name: 'Offline App', symbol: 'OFFL' }, confirmed: true });
  check(nl.token.status === 'gate_failed' && /no live link/.test(nl.token.note ?? ''), '(d) missing live_url → gate_failed', nl.token);
  check(deploys.length === before, '(d) no deploys on gate failures');
}

// (e) a program that doesn't allow tokens.
{
  const prep = (await tools.prepare_submission({ program_id: OFF, project: { name: 'Off Program App' } }, ctx())) as Record<string, unknown>;
  check(!('token' in prep), '(e) off program: prepare_submission has no token block');
  const r = await submit({ program: OFF, project: project('Off Program App'), token: { name: 'Off Program App', symbol: 'OFFP' }, confirmed: true });
  check(r.token.status === 'skipped' && /doesn't allow tokens/.test(r.token.note ?? ''), '(e) off program → skipped', r.token);
}

// (f) retry after the 404, with the stored ticker.
{
  const r = await launch({ project_id: retryProjectId });
  check(r.status === 'launched' && r.symbol === 'RETRY', '(f) launch_token retry launches the stored RETRY', r);
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
  check(r.token.status === 'skipped' && /builder_confirmed/.test(r.token.note ?? ''), '(h) unconfirmed → skipped', r.token);
  check(deploys.length === before, '(h) no deploy sent');
}

// (i) the monogram route, called directly.
{
  const { GET } = await import('../app/api/projects/[id]/token-image/route');
  const res = await GET(new Request(`http://localhost/api/projects/${aProjectId}/token-image`), {
    params: Promise.resolve({ id: String(aProjectId) }),
  });
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
  const r = await submit({ project: project('Kappa Launch'), confirmed: true });
  check(r.token.status === 'skipped' && /pass token/.test(r.token.note ?? ''), '(k) token omitted → skipped, "pass token"', r.token);
  check(deploys.length === before, '(k) no deploy sent');
  const saved = await row(r.project_id);
  check(saved.token_symbol === 'KAPPA' && saved.token_url === null, '(k) proposal stored for later', saved);
  const l = await launch({ project_id: r.project_id });
  check(l.status === 'launched' && l.symbol === 'KAPPA', '(k) launch_token launches the stored proposal', l);
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

check(authFailures === 0, 'every mock call carried the deploy key');

for (const req of hanging) req.socket.destroy();
server.closeAllConnections();
server.close();
await db.end();
console.log(`token e2e: ${checks} checks passed`);
