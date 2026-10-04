import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { publicNote, reviewRows } from './leaderboard';
import { VETO_ERRORS, VetoError, vetoEntry, vetoKey, vetoKeyMatches, vetoLink, vetoPost } from './veto';

const SECRET = 'v'.repeat(48);
const KEY = vetoKey('c1', SECRET)!;

test('vetoKey: per campaign, from ADMIN_VETO_SECRET; none without a long enough secret', () => {
  assert.match(KEY, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(vetoKey('c2', SECRET), KEY);
  assert.equal(vetoKey('c1', 'short'), null);
  assert.equal(vetoKey('c1', undefined), null);
  assert.equal(vetoKeyMatches('c1', KEY, SECRET), true);
  assert.equal(vetoKeyMatches('c2', KEY, SECRET), false);
  assert.equal(vetoKeyMatches('c1', '', SECRET), false);
  assert.equal(vetoLink('https://earnkit.com', 'c1', SECRET), `https://earnkit.com/admin/veto/c1?key=${KEY}`);
});

const post = (fields: Record<string, string>) =>
  new Request('https://earnkit.com/api/admin/veto', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '1.2.3.4' },
    body: new URLSearchParams(fields).toString(),
  });

const loc = (code: string) => `/admin/veto/c1?key=${KEY}&${code}`;

test('POST /api/admin/veto: the key, an entry id, then the veto; errors go back to the page as a code', async () => {
  process.env.ADMIN_VETO_SECRET = SECRET;
  const calls: unknown[][] = [];
  const deps = { limit: async () => {}, veto: async (...a: unknown[]) => { calls.push(a); } };
  assert.equal((await vetoPost(post({ slug: 'c1', key: 'nope', entry: '7' }), deps)).status, 404);
  const bad = await vetoPost(post({ slug: 'c1', key: KEY, entry: 'x' }), deps);
  assert.deepEqual([bad.status, bad.headers.get('location')], [303, loc('error=entry')]);
  assert.equal(calls.length, 0);
  const ok = await vetoPost(post({ slug: 'c1', key: KEY, entry: '7', reason: 'wash trading' }), deps);
  assert.deepEqual([ok.status, ok.headers.get('location')], [303, loc('removed=7')]);
  assert.deepEqual(calls, [['c1', 7, 'wash trading']]);
  const closed = await vetoPost(post({ slug: 'c1', key: KEY, entry: '7' }), {
    ...deps,
    veto: async () => { throw new VetoError('closed'); },
  });
  assert.deepEqual([closed.status, closed.headers.get('location')], [303, loc('error=closed')]);
  for (const code of ['entry', 'closed', 'rate-limited'] as const) assert.match(VETO_ERRORS[code], /^[A-Z][^\n]*\.$/);
  delete process.env.ADMIN_VETO_SECRET;
});

test('POST /api/admin/veto: rate limited per IP; never a veto then (a wrong key is still a 404)', async () => {
  process.env.ADMIN_VETO_SECRET = SECRET;
  const { RateLimitError } = await import('./rate-limit');
  const ips: string[] = [];
  const deps = {
    limit: async (ip: string) => { ips.push(ip); throw new RateLimitError('Too many.', 60); },
    veto: async () => assert.fail('no veto when rate limited'),
  };
  const r = await vetoPost(post({ slug: 'c1', key: KEY, entry: '7' }), deps);
  assert.deepEqual([r.status, r.headers.get('location')], [303, loc('error=rate-limited')]);
  assert.equal((await vetoPost(post({ slug: 'c1', key: 'nope', entry: '7' }), deps)).status, 404);
  assert.deepEqual(ips, ['1.2.3.4', '1.2.3.4']);
  delete process.env.ADMIN_VETO_SECRET;
});

test('publicNote: the public page never shows the raw payout note', () => {
  assert.equal(publicNote(null), null);
  assert.equal(publicNote({ state: 'review', note: null }), null);
  assert.equal(publicNote({ state: 'paid', note: 'No entry reached the minimum score; nothing to pay.' }), null);
  assert.equal(publicNote({ state: 'paying', note: null }), 'Paying winners now.');
  assert.equal(publicNote({ state: 'paying', note: 'Waiting for the transfer to entry #4 to be mined.' }), 'Waiting for a transfer to confirm.');
  for (const note of [
    "The payout wallet isn't set up yet (CAMPAIGN_PAYOUT_PRIVATE_KEY); nothing was sent.",
    'BASE_RPC_URL is not Base mainnet; nothing was sent.',
    'Payouts paused: a check failed; retrying hourly.',
  ])
    assert.equal(publicNote({ state: 'paying', note }), 'Payouts paused; they resume automatically.');
});

test('Review Focus 4: opening the link (GET) never removes anything; the page is rate limited and flags partial scores', () => {
  const app = join(import.meta.dirname, '../../app');
  const route = readFileSync(join(app, 'api/admin/veto/route.ts'), 'utf8');
  // Ruling 3: a POST wrapper (Next's route type check), not a re-export.
  assert.match(route, /export async function POST\(request: Request\) \{\s*return vetoPost\(request\);\s*\}/);
  assert.doesNotMatch(route, /\bGET\b/);
  const page = readFileSync(join(app, 'admin/veto/[slug]/page.tsx'), 'utf8');
  assert.match(page, /method="post"/);
  assert.doesNotMatch(page, /vetoEntry/);
  // Ruling 13: the GET counts against the veto limit; Ruling 20: capped reads are flagged.
  assert.match(page, /enforce\('veto', /);
  assert.match(page, /score_partial/);
  const campaign = readFileSync(join(app, 'campaigns/[slug]/page.tsx'), 'utf8');
  assert.match(campaign, /score_partial/);
});

// vetoEntry and reviewRows against a real database when one is configured; skipped otherwise.
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const campaign = {
  kind: 'earnkit' as const,
  prize: { token: '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07', symbol: 'MINI', decimals: 18, chain: 'base' as const },
  winners: 2, amount_each: '3', prize_usd_total: 200, metric: 'unique_wallets' as const, min_score: 1,
};

async function setup(tag: string, n: number) {
  const ends = new Date(Date.now() - 86_400_000);
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, campaign, starts_at, ends_at)
    VALUES (${tag}, 'o', 't', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown', ${sql().json(campaign as never)},
      ${new Date(ends.getTime() - 14 * 86_400_000)}, ${ends})`;
  const ids: number[] = [];
  for (let i = 1; i <= n; i++) {
    const [{ id }] = await sql()`
      INSERT INTO projects (program_id, name, repo_url, contracts, payout_wallet, submitted_at, score, score_final)
      VALUES (${tag}, ${'p' + i}, ${'https://github.com/a/' + tag + i}, ${[`0x${String(i).repeat(40)}`]},
        ${`0x${'e'.repeat(39)}${i}`}, ${new Date(Date.UTC(2026, 9, 6, i))}, ${10 - i}, true)
      RETURNING id`;
    ids.push(id);
  }
  return ids;
}

async function teardown(tag: string) {
  await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
  await sql()`DELETE FROM campaign_runs WHERE program_id = ${tag}`;
  await sql()`DELETE FROM programs WHERE id = ${tag}`;
}

test('vetoEntry: only an unpaid entry, only while the review is open; the next entry moves up', db, async () => {
  const tag = `test-veto-${process.pid}-${Date.now()}`;
  const [a, b, c] = await setup(tag, 3);
  try {
    // No review yet (running): refused.
    await sql()`INSERT INTO campaign_runs (program_id, state) VALUES (${tag}, 'running')`;
    await assert.rejects(vetoEntry(tag, a, 'x'), VetoError);
    await sql()`UPDATE campaign_runs SET state = 'review', review_until = now() + interval '48 hours' WHERE program_id = ${tag}`;
    // Another campaign's entry id: refused.
    await assert.rejects(vetoEntry(`${tag}-other`, a, 'x'), VetoError);
    // A paid entry: refused.
    await sql()`UPDATE projects SET prize_tx = ${'0x' + 'a'.repeat(64)} WHERE id = ${c}`;
    await assert.rejects(vetoEntry(tag, c, 'x'), VetoError);
    assert.deepEqual((await reviewRows(tag, campaign)).picks.map((p) => p.id), [a, b]);
    await vetoEntry(tag, a, '  wash\ntrading  ');
    const [row] = await sql()`SELECT vetoed_at, veto_reason FROM projects WHERE id = ${a}`;
    assert.ok(row.vetoed_at);
    assert.equal(row.veto_reason, 'wash trading');
    // Twice: refused (already removed).
    await assert.rejects(vetoEntry(tag, a, 'x'), VetoError);
    assert.deepEqual((await reviewRows(tag, campaign)).picks.map((p) => p.id), [b, c]);
    // The review deadline passed, before the cron moved on: refused (the page says so too).
    await sql()`UPDATE campaign_runs SET review_until = now() - interval '1 second' WHERE program_id = ${tag}`;
    await assert.rejects(vetoEntry(tag, b, 'x'), VetoError);
    await sql()`UPDATE campaign_runs SET review_until = now() + interval '1 hour' WHERE program_id = ${tag}`;
    // Once the payout started: refused.
    await sql()`UPDATE campaign_runs SET state = 'paying' WHERE program_id = ${tag}`;
    await assert.rejects(vetoEntry(tag, b, 'x'), VetoError);
  } finally {
    await teardown(tag);
  }
});

test('vetoEntry races the cron: a veto waits for the switch to paying and is then refused', db, async () => {
  const tag = `test-veto-race-${process.pid}-${Date.now()}`;
  const [a] = await setup(tag, 2);
  await sql()`INSERT INTO campaign_runs (program_id, state, review_until) VALUES (${tag}, 'review', now() + interval '1 hour')`;
  try {
    let veto: Promise<unknown> | undefined;
    await sql().begin(async (tx) => {
      // The cron's pay step, not yet committed.
      await tx`UPDATE campaign_runs SET state = 'paying' WHERE program_id = ${tag}`;
      veto = vetoEntry(tag, a, 'late').then(() => 'removed', (e) => e);
      await new Promise((r) => setTimeout(r, 200));
    });
    assert.ok((await veto) instanceof VetoError);
    const [row] = await sql()`SELECT vetoed_at FROM projects WHERE id = ${a}`;
    assert.equal(row.vetoed_at, null);
  } finally {
    await teardown(tag);
  }
});

test('reviewRows: evidence per entry (counted, smart, shared), and the frozen terms decide the picks', db, async () => {
  const tag = `test-review-${process.pid}-${Date.now()}`;
  const [a, b, c] = await setup(tag, 3);
  try {
    const w = (n: number) => `0x${String(n).repeat(40)}`.slice(0, 42);
    await sql()`INSERT INTO entry_wallets (project_id, wallet, kind) VALUES
      (${a}, ${w(7)}, 'eoa'), (${a}, ${w(8)}, 'smart'), (${b}, ${w(7)}, 'eoa'), (${b}, ${w(9)}, 'smart')`;
    await sql()`UPDATE projects SET score_partial = true, code_share = 0.25 WHERE id = ${b}`;
    const r = await reviewRows(tag, campaign);
    assert.deepEqual(
      r.ranked.map((e) => [e.id, e.rank, e.counted, e.smart, e.shared, e.score_partial, e.code_share]),
      [[a, 1, 2, 1, 1, false, null], [b, 2, 2, 1, 1, true, 0.25], [c, 3, 0, 0, 0, false, null]],
    );
    assert.deepEqual(r.picks.map((p) => p.id), [a, b]);
    // Terms frozen at the review (3 winners) win over the program's current ones.
    await sql()`INSERT INTO campaign_runs (program_id, state, terms) VALUES (${tag}, 'review',
      ${sql().json({ token: campaign.prize.token, symbol: 'MINI', decimals: 18, amount_each: '3', winners: 3, min_score: 1 })})`;
    assert.deepEqual((await reviewRows(tag, campaign)).picks.map((p) => p.id), [a, b, c]);
  } finally {
    await teardown(tag);
  }
});
