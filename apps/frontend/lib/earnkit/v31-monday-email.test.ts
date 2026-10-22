import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropPrograms, dropRunPrograms } from './fixtures/programs-cleanup';
import { withEnv } from './fixtures/find';
import { benchStepKey } from './bench-reply';
import { codesSettled } from './bench-find';
import { bestFitFor } from './best-fit';
import { newBackers } from './backers';
import { digestBody, digestFacts, sendDigests, type DigestFacts, type Mailer } from './digest';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { mainConfirmed } from './main-project';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v3.1 Task 12 (spec 3.3): the Monday email leads with the money action (the Best fit, as find and score name it) and
 * the week's new backers, each only when true; a program the builder applied to or declined never gets a line, and a
 * backer EarnKit saw before v3.1 is never new.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-monday-email-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await dropRunPrograms();
  await sql().end();
});
// This file's own database: only Base Builder Grants and the copies made here are open, so every fit is one named here
// (a16z speedrun and the rest would fit any repo by their real dates).
before(async () => {
  if (process.env.DATABASE_URL) await sql()`UPDATE programs SET status = 'closed' WHERE status = 'active' AND id <> 'base-builder-grants'`;
  // Opened long ago, so it is never a new program line (the money line is the email's only line in (b)).
  if (process.env.DATABASE_URL) await sql()`UPDATE programs SET opened_at = now() - interval '60 days' WHERE id = 'base-builder-grants'`;
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
const ROLLING = 'base-builder-grants';
const ROLLING_TITLE = 'Base Builder Grant Program';
const SCHEMA = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
type Ctx = Parameters<typeof mcpCall>[0];
type B = { ctx: Ctx; id: number; own: number; key: string; handle: string };
const addr = () => `0x${randomBytes(20).toString('hex')}`;
let n = 0;

/** A dated program (a copy of Base Builder Grants) closing `days` (and a few hours) from now. */
async function dated(tag: string, days: number) {
  const base = committedProgram(ROLLING);
  const id = `v31-mon-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + days * DAY + 3 * 3_600_000);
  const p = ProgramFile.parse({ ...base, id, title: `Monday ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  return { id, title: p.title };
}

/** A ranked builder (signed in with X, the repo proven by the App) the matcher fits for `programs` (v31-best-fit.test.ts). */
async function builder(tag: string, programs: string[]): Promise<B> {
  n++;
  const t = `ek_v31me_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `me${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `95${RUN}${n}${tag.length}`, username: handle, name: 'me', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `me${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: programs.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never,
    tokenDeps: { check: async () => true },
  } as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 9000 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  ctx.codesFetch = gh;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  return { ctx, id: c.id, own: c.own, key, handle };
}
/** The builder's own subscription, opted in a week ago. */
const sub = (b: B, email: string) => ({
  installation_id: b.own, login: '', email, shared: false, opted_in_at: new Date(Date.now() - 8 * DAY),
  unsubscribed_at: null, last_sent_at: null, last_considered_at: null,
});
async function subscribe(b: B, email: string) {
  await sql()`INSERT INTO digest_subscriptions (installation_id, email, asked_at, opted_in_at)
    VALUES (${b.own}, ${email}, ${new Date(Date.now() - 9 * DAY)}, ${new Date(Date.now() - 8 * DAY)})`;
}
const NO_FACTS: DigestFacts = { week: null, handle: null, money: [], newPrograms: [], wins: [], deadlines: [] };
const WEEK = {
  lines: ['Last week you finished at Shipping 40, #3.'],
  standing: { score: 40, rank: 3, total: 12 },
  approveUrl: 'https://earnkit.com/api/week?t=a',
  hideUrl: 'https://earnkit.com/api/week?t=h',
  approved: true,
};
const clean = (s: string) => assert.doesNotMatch(s, /\p{Extended_Pictographic}|—|points/u, s);

test('(a) a dated fit: the money line first, then the week', db, async () => {
  const p = await dated('a9', 9);
  const b = await builder('a', [p.id]);
  const best = await bestFitFor(b.id, new Date());
  assert.equal(best?.program_id, p.id, JSON.stringify(best));
  assert.equal(best?.title, p.title);
  assert.ok(best?.ends_at instanceof Date);
  const f = await digestFacts(sub(b, 'a@example.com'), new Date());
  const line = `${p.title} closes in 9 days. Your draft is one yes away.`;
  assert.deepEqual(f.money, [line]);
  clean(line);
  // The order: money, then the week, then the sections.
  const body = digestBody({ ...NO_FACTS, money: f.money, week: WEEK, wins: [{ name: 'PayLink', program: 'Arc', prize_usd: 500 }] })!;
  assert.ok(body.text.startsWith(`${line}\n\nLast week you finished at Shipping 40, #3.\n\nWon: PayLink in Arc, $500.`), body.text);
  assert.equal(body.subject, 'Your week on EarnKit: Shipping 40 · #3 of 12 builders');
  // One day out reads "1 day" (never 0).
  const soon = await dated('a1', 0);
  const b1 = await builder('a1', [soon.id]);
  assert.deepEqual((await digestFacts(sub(b1, 'a1@example.com'), new Date())).money, [`${soon.title} closes in 1 day. Your draft is one yes away.`]);
  // Every Base repo fits these copies: they leave so the next tests see only the rolling program.
  await dropPrograms([p.id, soon.id]);
});

test('(b) a rolling Base fit: "Base Builder Grant Program is open (rolling), and your draft is one yes away."', db, async () => {
  const b = await builder('b', [ROLLING]);
  const best = await bestFitFor(b.id, new Date());
  assert.deepEqual(best, { program_id: ROLLING, title: ROLLING_TITLE, ends_at: null });
  const f = await digestFacts(sub(b, 'b@example.com'), new Date());
  assert.deepEqual(f.money, ['Base Builder Grant Program is open (rolling), and your draft is one yes away.']);
  // Only money lines: the email still sends, subject "Your EarnKit week".
  assert.deepEqual(digestBody({ ...NO_FACTS, money: f.money }), { subject: 'Your EarnKit week', text: `${f.money[0]}\n\nAsk your agent "What can I earn?" to start.` });
  assert.equal((digestBody({ ...NO_FACTS, money: f.money })!.text.match(/What can I earn/g) ?? []).length, 1);
  await subscribe(b, 'b@example.com');
  const sent: Parameters<Mailer>[0][] = [];
  const r = await sendDigests(new Date(), { mail: async (m) => void sent.push(m), only: [b.own] });
  assert.equal(r.sent, 1, JSON.stringify(r));
  assert.equal(sent[0]!.subject, 'Your EarnKit week');
  assert.ok(sent[0]!.text.startsWith('Base Builder Grant Program is open (rolling), and your draft is one yes away.\n\nAsk your agent "What can I earn?" to start.\n\nOne email a week.'), sent[0]!.text);
  // A shared client's or a per-login subscription has no verified person: no money line.
  assert.deepEqual((await digestFacts({ ...sub(b, 'b@example.com'), shared: true }, new Date())).money, []);
  assert.deepEqual((await digestFacts({ ...sub(b, 'b@example.com'), login: 'someone' }, new Date())).money, []);
});

test('money lines and a week with no sections: the ask line comes last, after the week', () => {
  const money = ['Base Builder Grant Program is open (rolling), and your draft is one yes away.'];
  const week = { ...WEEK, approved: false };
  const text = digestBody({ ...NO_FACTS, money, week })!.text;
  assert.ok(text.startsWith(`${money[0]}\n\nLast week you finished at Shipping 40, #3.`), text);
  assert.ok(text.endsWith(`Hide this week: ${WEEK.hideUrl}\n\nAsk your agent "What can I earn?" to start.`), text);
  assert.equal(text.split('Ask your agent').length, 2);
  // A week alone still has no ask line.
  assert.ok(!digestBody({ ...NO_FACTS, week })!.text.includes('Ask your agent'));
});

test('(c) applied (builder_program_status) or declined: no money line', db, async () => {
  for (const status of ['applied', 'not_interested'] as const) {
    const b = await builder(`c${status[0]}`, [ROLLING]);
    await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', ${ROLLING}, ${status}, now())`;
    assert.equal(await bestFitFor(b.id, new Date()), null, status);
    assert.deepEqual((await digestFacts(sub(b, 'c@example.com'), new Date())).money, [], status);
  }
  // Declined the apply ask (standing_seen.declined) within 30 days.
  const d = await builder('cd', [ROLLING]);
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
    || jsonb_build_object('declined', jsonb_build_object(${benchStepKey('apply', ROLLING)}::text, now()::text)) WHERE builder_id = ${d.id}`;
  assert.equal(await bestFitFor(d.id, new Date()), null);
  assert.deepEqual((await digestFacts(sub(d, 'd@example.com'), new Date())).money, []);
  // An unlisted program is never the Best fit.
  const u = await dated('cu', 9);
  const bu = await builder('cu', [u.id]);
  assert.equal((await bestFitFor(bu.id, new Date()))?.program_id, u.id, 'dated first while listed');
  await sql()`UPDATE programs SET status = 'unlisted' WHERE id = ${u.id}`;
  assert.equal((await bestFitFor(bu.id, new Date()))?.program_id, ROLLING, 'unlisted: gone, the rolling fit is next');
  assert.ok(!(await digestFacts(sub(bu, 'u@example.com'), new Date())).money.some((l) => l.includes(u.title)));
  await dropPrograms([u.id]);
  // No project: null, never an error.
  assert.equal(await bestFitFor(2_000_000_000, new Date()), null);
});

test('(d) 2 backers first seen in the last 7 days: "2 new backers this week."; flag off: none; pre-migration rows never count', db, async () => {
  const b = await builder('d', []);
  // The rolling program is told applied, so only the backers line is money here.
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', ${ROLLING}, 'applied', now())`;
  const coin = addr();
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at,
      coin_launched_at, coin_address, coin_tx, coin_chain_id, creator_wallet)
    VALUES ('earnkit-coin', 'Kit', ${`https://github.com/${b.key}`}, ${`github.com/${b.key.toLowerCase()}`}, ${b.id},
      'KITD', 'launched', ${`https://tokens.fun/coin/${coin}`}, now(), now(), ${coin}, ${`0x${'a'.repeat(64)}`}, 8453, ${addr()})`;
  const now = new Date();
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block, first_seen_at) VALUES
    (${coin}, ${addr()}, 6000, ${new Date(now.getTime() - DAY)}), (${coin}, ${addr()}, 6001, ${new Date(now.getTime() - 2 * DAY)}),
    (${coin}, ${addr()}, 5000, ${new Date(now.getTime() - 10 * DAY)}), (${coin}, ${addr()}, 4000, 'epoch')`;
  const since = new Date(now.getTime() - 7 * DAY);
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    assert.equal(await newBackers(b.id, since), 2);
    const f = await digestFacts(sub(b, 'd@example.com'), now);
    assert.deepEqual(f.money, ['2 new backers this week.']);
    assert.equal(digestBody({ ...NO_FACTS, money: f.money })!.text, '2 new backers this week.\n\nAsk your agent "What can I earn?" to start.');
    // One reads "backer".
    await sql()`UPDATE coin_backers SET first_seen_at = 'epoch' WHERE coin = ${coin} AND first_block = 6001`;
    assert.deepEqual((await digestFacts(sub(b, 'd@example.com'), now)).money, ['1 new backer this week.']);
    // Backing closed: none.
    await sql()`UPDATE projects SET raising_at = NULL WHERE coin_address = ${coin}`;
    assert.equal(await newBackers(b.id, since), 0);
    await sql()`UPDATE projects SET raising_at = now() WHERE coin_address = ${coin}`;
  });
  await withEnv({ EARNKIT_RAISING: undefined }, async () => {
    assert.equal(await newBackers(b.id, since), 0);
    assert.deepEqual((await digestFacts(sub(b, 'd@example.com'), now)).money, []);
  });
  // A row written before v3.1 (no first_seen_at) becomes 'epoch' at migration: never new.
  await sql()`ALTER TABLE coin_backers DROP COLUMN first_seen_at`;
  const old = addr();
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${old}, 7000)`;
  await sql().unsafe(SCHEMA);
  const [row] = await sql()<{ at: Date }[]>`SELECT first_seen_at AS at FROM coin_backers WHERE coin = ${coin} AND wallet = ${old}`;
  assert.equal(row!.at.getTime(), 0);
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => assert.equal(await newBackers(b.id, since), 0, 'every row is pre-migration now'));
  // A row written after the migration without a value is seen now.
  const fresh = addr();
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${fresh}, 7001)`;
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => assert.equal(await newBackers(b.id, since), 1));
});

test('(f) fix round 1: the Best fit opened since the last send is the money line only, never also a "New:" line', db, async () => {
  const b = await builder('f', [ROLLING]);
  await sql()`UPDATE programs SET opened_at = now() - interval '1 day' WHERE id = ${ROLLING}`;
  try {
    const f = await digestFacts(sub(b, 'f@example.com'), new Date());
    assert.deepEqual(f.money, ['Base Builder Grant Program is open (rolling), and your draft is one yes away.']);
    assert.ok(!f.newPrograms.some((p) => p.title === ROLLING_TITLE), JSON.stringify(f.newPrograms));
    assert.doesNotMatch(digestBody(f)!.text, /New: Base Builder Grant Program/);
    // Told applied: no money line either.
    await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', ${ROLLING}, 'applied', now())`;
    assert.deepEqual((await digestFacts(sub(b, 'f@example.com'), new Date())).money, []);
  } finally {
    await sql()`UPDATE programs SET opened_at = now() - interval '60 days' WHERE id = ${ROLLING}`;
  }
});

test('(g) fix round 1: the reply gates: an unconfirmed project or a signed-out (unranked) builder gets no Best fit', db, async () => {
  const u = await builder('gu', [ROLLING]);
  assert.equal((await bestFitFor(u.id, new Date()))?.program_id, ROLLING, 'ranked and confirmed: named');
  await sql()`UPDATE builder_projects SET confirmed = false WHERE builder_id = ${u.id}`;
  assert.equal(await bestFitFor(u.id, new Date()), null, 'unconfirmed');
  assert.deepEqual((await digestFacts(sub(u, 'gu@example.com'), new Date())).money, []);
  // Signed out with X sign-in on: the reply is in the signed_out state, never ranked.
  const s = await builder('gs', [ROLLING]);
  await sql()`UPDATE builder_profiles SET x_user_id = NULL, x_handle = NULL WHERE builder_id = ${s.id}`;
  await sql()`UPDATE installations SET x_user_id = NULL WHERE id IN (${s.id}, ${s.own})`;
  assert.ok(await mainConfirmed(s.id), 'still confirmed: only the sign-in gate drops it');
  assert.equal(await bestFitFor(s.id, new Date()), null, 'signed out');
  assert.deepEqual((await digestFacts(sub(s, 'gs@example.com'), new Date())).money, []);
});

test('(e) schema rerun is a no-op and keeps first_seen_at', db, async () => {
  const coin = addr();
  const at = new Date('2026-10-20T10:00:00Z');
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block, first_seen_at) VALUES (${coin}, ${addr()}, 1, ${at})`;
  await sql().unsafe(SCHEMA);
  await sql().unsafe(SCHEMA);
  const [row] = await sql()<{ at: Date }[]>`SELECT first_seen_at AS at FROM coin_backers WHERE coin = ${coin}`;
  assert.equal(row!.at.toISOString(), at.toISOString());
  const [col] = await sql()<{ nullable: string; def: string | null }[]>`
    SELECT is_nullable AS nullable, column_default AS def FROM information_schema.columns WHERE table_name = 'coin_backers' AND column_name = 'first_seen_at'`;
  assert.equal(col!.nullable, 'NO');
  assert.match(col!.def ?? '', /now\(\)/);
});
