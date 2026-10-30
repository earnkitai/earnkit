import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { STATS_KEYS, STATS_LABELS, readStats, statsFrom } from './stats';

/** v4.7.1 Task 2: no points or open-pool key in the public stats, the legacy token yes launches nothing, /install redirects. */
process.env.EARNKIT_AUTH_SECRET ??= 'v471-cleanup-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
// The retired figures: "points" and the open prize pools (bonus_pools_eth is the builder bonus in ETH, a different figure).
const RETIRED = /point|open_pool/;

test('statsFrom, STATS_KEYS and STATS_LABELS carry no points or open-pool key; one open-money figure', () => {
  const s = statsFrom({ open_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0, tokens_declined: 0, bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0, labelled_entries: 0, entries_won: 0, builders_won_usd: null } as never);
  for (const k of [...Object.keys(s), ...STATS_KEYS, ...Object.keys(STATS_LABELS)]) assert.doesNotMatch(k, RETIRED, k);
  assert.deepEqual(Object.keys(s), [...STATS_KEYS]);
  assert.equal(Object.keys(s).filter((k) => k.startsWith('open_money')).length, 2, 'open_money_usd and its text only');
});

test('the /api/stats read (readStats) has no points or open-pool key', db, async () => {
  for (const k of Object.keys(await readStats())) assert.doesNotMatch(k, RETIRED, k);
});

async function signedIn(tag: string) {
  const t = `ek_v471c_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const own = (await connectInstallation(t))!.own;
  const handle = `v471c${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `96${RUN}${tag.length}${Math.floor(Math.random() * 1e6)}`, username: handle, name: 'v', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const calls: unknown[] = [];
  const fetch = (async (_u: string, init?: RequestInit) => {
    calls.push(init?.body);
    return new Response(JSON.stringify({ success: true, tokenAddress: `0x${randomBytes(20).toString('hex')}`, txHash: '0xabc', chainId: 8453 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, builderTokenDeps: { fetch, check: async () => true }, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${c.id}, now())`;
  return { ctx, id: c.id, calls };
}
const tokenRow = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${id}`)[0]?.status ?? null;
const ask = (id: number) =>
  sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"wallet_setup","key":null},"token_offered":"2026-10-01T00:00:00Z"}'::jsonb WHERE builder_id = ${id}`;

test('a yes to a stored v4.0 wallet_setup with token_offered never launches a token and asks nothing', db, async () => {
  const prev = { on: process.env.EARNKIT_BUILDER_TOKENS, key: process.env.TOKENSFUN_DEPLOY_API_KEY };
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'v471c-key';
  try {
    for (const via of ['coin', 'move_up_coin'] as const) {
      const p = await signedIn(via === 'coin' ? 'a' : 'b');
      await ask(p.id);
      const input = via === 'coin' ? { coin: { project_key: 'x/y', answer: 'yes' } } : { move_up: { kind: 'coin', project_key: null, answer: 'yes' } };
      const r = await mcpCall(p.ctx, 'tell', input);
      assert.equal(r.isError, false, r.text);
      assert.equal(p.calls.length, 0);
      assert.equal(await tokenRow(p.id), null);
      assert.equal(show(r), 'Your setup is done.');
      assert.doesNotMatch(show(r), /\?/);
    }
  } finally {
    if (prev.on === undefined) delete process.env.EARNKIT_BUILDER_TOKENS; else process.env.EARNKIT_BUILDER_TOKENS = prev.on;
    if (prev.key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY; else process.env.TOKENSFUN_DEPLOY_API_KEY = prev.key;
  }
});

test('/install redirects to the docs install section', async () => {
  const { default: Install } = await import('../../app/install/page');
  assert.throws(() => Install(), (e: unknown) => {
    const d = String((e as { digest?: string }).digest ?? '');
    return d.startsWith('NEXT_REDIRECT') && d.includes('/docs#install') && d.includes('308');
  });
});
