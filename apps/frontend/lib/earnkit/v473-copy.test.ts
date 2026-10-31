import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { walletOffered } from './fixtures/wallet-step';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { needsAsk, openNowLine, possessive } from './bench-reply';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v472-next-step-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');

let n = 0;
/** A ranked builder (X, the repo proven by the App) the matcher fits for `programs` (none: no fit). */
async function builder(tag: string, programs: string[]) {
  n++;
  const t = `ek_v472_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `mo${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `472${RUN}${n}${tag.length}`, username: handle, name: 'mo', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `mo${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: programs.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 47200 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  // The connect weeks are another task's moment; Base's grant steps were declined today (the owner's account).
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key };
}

/** A copy of a committed program, open, closing `minutes` from now; Arc keeps its contract rule. */
async function program(file: string, tag: string, minutes: number) {
  const base = committedProgram(file, { keepContract: file.startsWith('arc') });
  const id = `v472-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + minutes * 60_000);
  const p = ProgramFile.parse({ ...base, id, title: `Need ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  return { id, title: p.title };
}
/** Every open program but `keep` said no to (the needs ask), so the test's own two are the only candidates. */
async function declineOthers(id: number, keep: string[]) {
  const rows = await sql()<{ id: string }[]>`SELECT id FROM programs WHERE status = 'active' AND (ends_at IS NULL OR ends_at > now()) AND NOT (id = ANY(${keep}::text[]))`;
  const declined = Object.fromEntries(rows.map((r) => [`needs:${r.id}`, new Date().toISOString()]));
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
    COALESCE(standing_seen->'declined', '{}'::jsonb) || ${sql().json(declined as never)}::jsonb) WHERE builder_id = ${id}`;
}
const last = (s: string) => s.split('\n\n').at(-1)!;
const moveUpOf = (r: Awaited<ReturnType<typeof mcpCall>>) => r.reply?.move_up as { kind: string; why?: string; agent_note: string } | undefined;
const find = (b: { ctx: unknown }) => mcpCall(b.ctx as never, 'find', {});

const GRANTS = [
  { title: 'Arc Microgrants: Built with Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1' },
  { title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling' },
];
const INVEST = { title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1' };

test('openNowLine: the owner line, investment beside the total', () => {
  assert.equal(
    openNowLine(GRANTS, { total: '$105.5K', invest: INVEST }),
    'Open now: $105.5K in grants, plus a16z speedrun SR008, up to $1M investment, closes Nov 1. Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Base Builder Grant Program, $5,000, rolling.',
  );
});

test('openNowLine: no total and no investment variants', () => {
  assert.equal(openNowLine([], { total: '$9K', invest: INVEST }), 'Open now: a16z speedrun SR008, up to $1M investment, closes Nov 1.');
  assert.equal(
    openNowLine(GRANTS, { total: '$105.5K', invest: null }),
    'Open now: $105.5K in grants. Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Base Builder Grant Program, $5,000, rolling.',
  );
  assert.equal(openNowLine(GRANTS), 'Open now: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Base Builder Grant Program, $5,000, rolling.');
  assert.equal(openNowLine([]), null);
});

test('needsAsk: first and later showings, possessive', () => {
  const arc = 'Arc Microgrants: Built with Arc Studio';
  assert.equal(needsAsk('Kit', arc, ['x']), 'Want the steps to get Kit ready for Arc Microgrants?');
  assert.equal(needsAsk('Kit', arc, ['x'], true), 'Want the Arc Microgrants steps?');
  assert.equal(needsAsk('Kit', arc, []), "Want me to check Arc Microgrants' requirements for Kit?");
  assert.equal(needsAsk('Kit', arc, [], true), "Want me to check Arc Microgrants' requirements?");
  assert.equal(needsAsk('Kit', 'Base Grants', [], true), "Want me to check Base Grants' requirements?");
  assert.equal(needsAsk('Kit', 'Foundry: x', [], true), "Want me to check Foundry's requirements?");
  assert.equal(possessive('Microgrants'), "Microgrants'");
  assert.equal(possessive('Kit'), "Kit's");
  assert.doesNotMatch(needsAsk('Kit', arc, [], true), /Microgrants's/);
});

test('three finds on a ranked no-fit builder: the why once, then the short ask, move_up.why kept', db, async () => {
  const A = await program('arc-microgrants-studio', 'ca', 10);
  const b = await builder('c3', []);
  await declineOthers(b.id, [A.id]);
  for (let i = 1; i <= 3; i++) {
    const r = await find(b);
    const s = show(r);
    const ps = s.split('\n\n');
    const why = `${A.title} needs Kit on Arc mainnet.`;
    if (i === 1) {
      assert.equal(last(s), needsAsk('Kit', A.title, ['on Arc mainnet']), s);
      assert.equal(ps.at(-2), why, s);
    } else {
      assert.equal(last(s), `Want the ${A.title} steps?`, `find ${i}: ${s}`);
      assert.ok(!s.includes('needs Kit on Arc mainnet'), s);
    }
    assert.equal(moveUpOf(r)?.why, why, `find ${i}`);
    assert.equal((s.match(/\?/g) ?? []).length, 1, s);
  }
});

test('a no-gap program: later question is exact', db, async () => {
  const A = await program('base-builder-grants', 'cn', 12);
  const b = await builder('cn', []);
  await declineOthers(b.id, [A.id]);
  const first = show(await find(b));
  const later = show(await find(b));
  assert.equal(last(first), needsAsk('Kit', A.title, []), first);
  assert.equal(last(later), needsAsk('Kit', A.title, [], true), later);
  assert.equal(last(later), `Want me to check ${A.title}'s requirements?`, later);
});
