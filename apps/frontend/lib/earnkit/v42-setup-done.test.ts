import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { appEnv, installApp } from './fixtures/app-install';
import { fakeGitHub } from './fixtures/fake-github';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { NO_GITHUB_HINT, benchReply, closestAsk, pickRepoAgain, setupDoneLead, setupDoneReply, stateAsk, walletDone, type BenchProject, type BenchView } from './bench-reply';
import { CLOSEST_NOTE, closestStep } from './bench-find';
import { formatReply } from './reply-format';
import { reportedNameIn } from './project-name';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { walletMessage, walletPost } from './wallet-proof';
import { tradeUrl } from './builder-token';

/**
 * v4.2 Task 2 (F3, F4, F9, F15, F16): setup done is one warm reply with money: the table when programs are open, the
 * trade link when this sign launched the token, no separate "Done" message, no points in any builder-facing line, the
 * name as the builder gave it, the Lovable or Bolt line on a repeated step 2. tokens.fun is faked.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v42-setup-done-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
type Ctx = Parameters<typeof mcpCall>[0];
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const hex = (k: number) => randomBytes(k).toString('hex');
const ROLLING = 'base-builder-grants';
const OPEN = "Here's what's open for you right now:";

// ---- pure copy

test('F4: the sign-launch lead names the live token and its trade link; the contracts line only when told', () => {
  const trade = tradeUrl('0x' + 'ab'.repeat(20));
  assert.equal(setupDoneLead('Maya', 'launched', true, trade), `You're all set, Maya. Your token is live, so your community can back what you're building: ${trade}\n\n${OPEN}`);
  assert.equal(setupDoneLead('Maya', 'launched'), `You're all set, Maya. Your community can now back what you're building.\n\n${OPEN}`);
  assert.equal(walletDone('0xab…cd'), 'Done. Your rewards now go to 0xab…cd.');
  assert.equal(walletDone('0xab…cd', true), 'Done. Your rewards now go to 0xab…cd. Your contracts on Base will show on your page soon.');
});

test('F3: the closest program line; the table is never replaced by "doesn\'t fit" when rows exist', () => {
  assert.equal(closestAsk('Arc Builders', 'real users'), 'Arc Builders is the closest. It needs real users. Want help with it?');
  const rows = [{ program: 'Arc Builders', upTo: '$10,000', closes: 'Nov 15' }];
  const s = setupDoneReply('Maya', 'skipped', rows, "MealMate doesn't fit an open program yet.", { closest: { program: 'Arc Builders', step: closestStep('long_shot', 'maya/kit') } });
  assert.doesNotMatch(s, /doesn't fit/);
  assert.ok(s.includes('| Arc Builders | $10,000 | Nov 15 |'), s);
  assert.ok(s.endsWith('Arc Builders is the closest. It needs more shipped work first. Want help with it?'), s);
  assert.equal(closestStep('company', null), 'a full-time team');
  assert.equal(closestStep(undefined, null), 'your code connected');
  // The plain surface (WhatsApp-style agents): rows as "Label: value" lines, the closest question last.
  const plain = formatReply(s, 'plain');
  assert.doesNotMatch(plain, /\||\*\*/, plain);
  assert.ok(plain.includes('Arc Builders: $10,000, Nov 15'), plain);
  assert.ok(plain.endsWith('Arc Builders is the closest. It needs more shipped work first. Want help with it?'), plain);
  assert.match(setupDoneReply('Maya', 'skipped', [], "MealMate doesn't fit an open program yet."), /doesn't fit an open program yet\.$/);
});

test('F15: the name the builder gave wins when the repo differs only by case or punctuation', () => {
  const projects = [{ name: 'MealMate', live_url: 'https://mealmate.lovable.app' }];
  assert.equal(reportedNameIn(projects, 'maya/mealmate'), 'MealMate');
  assert.equal(reportedNameIn(projects, 'maya/meal-mate'), 'MealMate');
  assert.equal(reportedNameIn(projects, 'maya/other'), null);
  // The builder's one main project: the name they gave wins even when the repo cannot be matched to it.
  assert.equal(reportedNameIn(projects, 'maya/kit-v2', true), 'MealMate');
  assert.equal(reportedNameIn([...projects, { name: 'Other' }], 'maya/kit-v2', true), null);
  assert.equal(reportedNameIn(projects, 'https://mealmate.lovable.app/'), 'MealMate');
});

test('F16: the repeated step 2 keeps the Lovable or Bolt line for a builder without GitHub', () => {
  assert.equal(pickRepoAgain('L'), "Connect your app's code so I can match it (read-only, one click): L\nDone?");
  assert.equal(pickRepoAgain('L', true), `Connect your app's code so I can match it (read-only, one click): L\n${NO_GITHUB_HINT}\nDone?`);
});

test('F9: no builder-facing reply says points', () => {
  const project: BenchProject = { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 4 };
  const base = { state: 'ranked' as const, variant: null, project, link: null, handle: 'maya' };
  const view = (ask: BenchView['ask'], o: Partial<BenchView> = {}): BenchView =>
    ({ ...base, rank: '#3 of 12 builders', streak: 4, target: 'Ship code this week to pass #2.', fund: [], due: [], held: null, ask, ...o });
  const asks: BenchView['ask'][] = [
    stateAsk(base),
    { kind: 'none', project_key: 'maya/kit', line: '' },
    stateAsk({ ...base, apply: { program_id: 'p', title: 'Base Builder Grant Program', amount: '$5,000', when: null } }),
    stateAsk({ ...base, connect: { weeks: 3 } }),
  ];
  for (const a of asks) {
    const s = benchReply(view(a, a.kind === 'connect' ? { connect: { weeks: 3 } } : {}));
    assert.doesNotMatch(s, /points?\b/i, s);
  }
});

// ---- the flows

let n = 0;
async function signedIn(tag: string, name = 'Maya Lin') {
  n++;
  const t = `ek_v42sd_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `v42${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `92${RUN}${n}${tag.length}`, username: handle, name, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  return { c, handle };
}

test('F3: a builder with no GitHub and no repo skips the wallet and sees the open programs table, never "doesn\'t fit"', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const { c } = await signedIn('lv');
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Ctx;
  await mcpCall(ctx, 'find', { agent_can_build: false });
  await mcpCall(ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'no' } });
  const again = show(await mcpCall(ctx, 'find', { agent_can_build: false }));
  assert.match(again, /\*\*Step 3 of 3:\*\*/, again);
  assert.doesNotMatch(again, /points/i);
  const r = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: null, answer: 'no' } });
  const s = show(r);
  assert.ok(s.startsWith("No worries, add it whenever you're ready."), s);
  assert.doesNotMatch(s, /doesn't fit an open program yet/, s);
  assert.match(s, /\| Program \| Up to \| Closes \|/, s);
  assert.match(s, /Want help with it\?$/, s);
  // A closest-program yes is the step it needs, never a draft of an application.
  {
    assert.equal((r.reply?.move_up as { kind?: string } | undefined)?.kind, 'closest');
    const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'closest', project_key: null, answer: 'yes' } });
    assert.match(show(yes), /^Your next step toward .+: .+\.\n\nWant help with it now\?$/, show(yes));
    assert.equal(yes.reply?.lead, undefined);
  }
});

test('final review 3: a no to the closest-program question is its own (never a no to Base\'s grant steps); a kindless yes routes it', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  for (const kindless of [false, true]) {
    const { c } = await signedIn(kindless ? 'cy' : 'cn');
    const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Ctx;
    await mcpCall(ctx, 'find', { agent_can_build: false });
    await mcpCall(ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'no' } });
    await mcpCall(ctx, 'find', { agent_can_build: false });
    const r = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: null, answer: 'no' } });
    assert.deepEqual(r.reply?.move_up, { kind: 'closest', project_key: null, agent_note: CLOSEST_NOTE });
    const [{ k }] = await sql()<{ k: string }[]>`SELECT standing_seen->'bench_ask'->>'kind' AS k FROM builder_profiles WHERE builder_id = ${c.id}`;
    assert.equal(k, 'closest');
    if (kindless) {
      assert.match(show(await mcpCall(ctx, 'tell', { move_up: { project_key: null, answer: 'yes' } })), /^Your next step toward /);
      continue;
    }
    await mcpCall(ctx, 'tell', { move_up: { kind: 'closest', project_key: null, answer: 'no' } });
    const [{ d }] = await sql()<{ d: Record<string, string> | null }[]>`SELECT standing_seen->'declined' AS d FROM builder_profiles WHERE builder_id = ${c.id}`;
    // base-qualify.ts qualifyOffer reads declined['qualify:<key>']: untouched, so Base's grant steps are still offered.
    assert.ok(d && Object.keys(d).some((x) => x.startsWith('closest:')), JSON.stringify(d));
    assert.ok(!Object.keys(d ?? {}).some((x) => x.startsWith('qualify:')), JSON.stringify(d));
    const [{ k: after_ }] = await sql()<{ k: string | null }[]>`SELECT standing_seen->'bench_ask'->>'kind' AS k FROM builder_profiles WHERE builder_id = ${c.id}`;
    assert.equal(after_, null);
  }
});

const repoFacts = (key: string): RepoFit[] => {
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  return [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: [{ program_id: ROLLING, program: ROLLING, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }],
  }];
};

test('F4 (pre-v4.4 in-flight, token sentence shown): the wallet "done" while step 3 is open is the setup-done reply (one message), with the trade link', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const { c, handle } = await signedIn('sg');
  const key = `${handle}/kit`;
  const coin = `0x${hex(20)}`;
  const f = (async () => new Response(JSON.stringify({ success: true, tokenAddress: coin, txHash: '0xabc', chainId: 8453 }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits: repoFacts(key) })) as never,
    tokenDeps: { check: async () => true }, builderTokenDeps: { fetch: f, check: async () => true },
  } as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 50_000 + Math.floor(Math.random() * 40_000);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  (ctx as { codesFetch?: typeof fetch }).codesFetch = gh as typeof fetch;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  const step = show(await mcpCall(ctx, 'find', {}));
  assert.match(step, /\*\*Step 3 of 3:\*\*/, step);
  // v4.4: step 3 never sets token_offered; a builder shown v4.0's token sentence has it (v44-setup-order.test.ts: the offer).
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('token_offered', now()::text) WHERE builder_id = ${c.id}`;
  const t = decodeURIComponent(/https:\/\/earnkit\.com\/claim\/wallet\?t=(\S+)/.exec(step)![1]);
  const acct = privateKeyToAccount(generatePrivateKey());
  const signature = await acct.signMessage({ message: walletMessage(handle, t) });
  const res = await walletPost(
    new Request('https://earnkit.com/claim/wallet', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com' }, body: JSON.stringify({ t, wallet: acct.address, signature }) }),
    { limit: async () => {}, verify: (a) => verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` }), discover: async () => {}, builderToken: { fetch: f, check: async () => true } },
  );
  assert.equal(res.status, 200);
  for (let i = 0; i < 50; i++) {
    const [row] = await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${c.id}`;
    if (row && row.status !== 'launching') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const r = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } });
  const s = show(r);
  assert.ok(s.startsWith(`You're all set, Maya. Your token is live, so your community can back what you're building: ${tradeUrl(coin)}`), s);
  assert.doesNotMatch(s, /Done\. Your rewards now go to/, s);
  assert.match(s, /\| Program \| Up to \| Closes \|/, s);
  assert.doesNotMatch(s, /doesn't fit|points/i, s);
  // Said once: the next reply is not the setup-done reply again.
  assert.doesNotMatch(show(await mcpCall(ctx, 'find', {})), /You're all set/);
});
