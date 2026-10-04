import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULE_NOTE, alertFacts, alertLines, sinceLine, sinceYouLastChecked, type AlertFacts } from './alerts';
import { sql } from './db';
import { rememberWallets } from './installations';
import { tools } from './tools';

const empty: AlertFacts = { newCampaigns: [], standings: [], prizes: [], fees: null };
const t = (h: number) => new Date(Date.UTC(2026, 9, 10, h));

test('a prize paid shows once, with its amount and transaction link (seen ids, not time)', () => {
  const f: AlertFacts = { ...empty, prizes: [{ project_id: 1, name: 'Tip Jar', won: '$100 in MINI', prize_tx: '0xabc', paid_at: t(5) }] };
  const r = alertLines({ checkedAt: t(4), state: null, feeAlertedUsd: null }, f);
  assert.deepEqual(r.lines, ['you won $100 in MINI with Tip Jar (basescan.org/tx/0xabc)']);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: r.state, feeAlertedUsd: null }, f).lines, []);
});

test('a prize paid between the facts read and the write (paid before checkedAt) still shows next time', () => {
  // Check 1 saw no prize but stored checkedAt = t(6); the prize was paid at t(5), in between.
  const first = alertLines({ checkedAt: t(4), state: { top: {} }, feeAlertedUsd: null }, empty);
  const f: AlertFacts = { ...empty, prizes: [{ project_id: 1, name: 'Tip Jar', won: '$100 in MINI', prize_tx: '0xabc', paid_at: t(5) }] };
  assert.deepEqual(alertLines({ checkedAt: t(6), state: first.state, feeAlertedUsd: null }, f).lines, [
    'you won $100 in MINI with Tip Jar (basescan.org/tx/0xabc)',
  ]);
});

test('a wallet added later shows its old win once; at most the 3 most recent prizes per check, the rest next time', () => {
  const prize = (id: number, h: number) => ({ project_id: id, name: `P${id}`, won: '$100 in MINI', prize_tx: `0x${id}`, paid_at: t(h) });
  const seen = alertLines({ checkedAt: t(1), state: { top: {} }, feeAlertedUsd: null }, empty).state;
  const old: AlertFacts = { ...empty, prizes: [prize(9, 0)] };
  const r = alertLines({ checkedAt: t(20), state: seen, feeAlertedUsd: null }, old);
  assert.deepEqual(r.lines, ['you won $100 in MINI with P9 (basescan.org/tx/0x9)']);
  assert.deepEqual(alertLines({ checkedAt: t(21), state: r.state, feeAlertedUsd: null }, old).lines, []);
  const many: AlertFacts = { ...empty, prizes: [prize(1, 1), prize(2, 4), prize(3, 2), prize(4, 3)] };
  const m = alertLines({ checkedAt: null, state: null, feeAlertedUsd: null }, many);
  assert.deepEqual(m.lines.map((l) => l.split(' with ')[1].split(' ')[0]), ['P2', 'P4', 'P3']);
  // The 4th waits for the next check (not lost), then nothing.
  const next = alertLines({ checkedAt: t(5), state: m.state, feeAlertedUsd: null }, many);
  assert.deepEqual(next.lines, ['you won $100 in MINI with P1 (basescan.org/tx/0x1)']);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: next.state, feeAlertedUsd: null }, many).lines, []);
});

test('other wins (sponsor) come right after EarnKit wins, before fees and other news', () => {
  const f: AlertFacts = {
    ...empty,
    fees: { usd: 138, tokens: [{ url: 'https://tokens.fun/coin/0xabc', symbol: 'TIP' }] },
    prizes: [{ project_id: 1, name: 'Tip Jar', won: '$100 in MINI', prize_tx: '0x1', paid_at: t(5) }],
    newCampaigns: [{ id: 'c2', title: 'C2', prize: '$50 each to top 3 (in MINI)', opened_at: t(5) }],
  };
  assert.deepEqual(alertLines({ checkedAt: t(4), state: { top: {} }, feeAlertedUsd: null }, f, ['you won 900 USDC with Tip Jar']).lines, [
    'you won $100 in MINI with Tip Jar (basescan.org/tx/0x1)',
    'you won 900 USDC with Tip Jar',
    'your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc)',
    'new: C2 ($50 each to top 3 (in MINI))',
  ]);
});

test('rank changes into and out of the top N, only for scored entries and only against what was seen', () => {
  const s = (inTop: boolean, scored = true) => ({ project_id: 7, name: 'Tip Jar', campaign_title: 'C1', winners: 5, scored, inTop });
  const prev = { checkedAt: t(1), feeAlertedUsd: null };
  assert.deepEqual(alertLines({ ...prev, state: { top: { 7: false } } }, { ...empty, standings: [s(true)] }).lines, ['Tip Jar moved into the top 5 of C1']);
  assert.deepEqual(alertLines({ ...prev, state: { top: { 7: true } } }, { ...empty, standings: [s(false)] }).lines, ['Tip Jar dropped out of the top 5 of C1']);
  assert.deepEqual(alertLines({ ...prev, state: { top: { 7: true } } }, { ...empty, standings: [s(true)] }).lines, []);
  // First score straight into the top: news. First-ever check (no state): silent.
  assert.deepEqual(alertLines({ ...prev, state: { top: {} } }, { ...empty, standings: [s(true)] }).lines, ['Tip Jar moved into the top 5 of C1']);
  assert.deepEqual(alertLines({ checkedAt: null, state: null, feeAlertedUsd: null }, { ...empty, standings: [s(true)] }).lines, []);
  assert.deepEqual(alertLines({ ...prev, state: { top: {} } }, { ...empty, standings: [s(true, false)] }).state.top, {});
});

test('a campaign is news once it is first seen; the first-ever check is quiet', () => {
  const f: AlertFacts = { ...empty, newCampaigns: [{ id: 'c1', title: 'EarnKit Campaign #1', prize: '$100 each to top 5 (in MINI)', opened_at: t(5) }] };
  const r = alertLines({ checkedAt: t(4), state: { top: {} }, feeAlertedUsd: null }, f);
  assert.deepEqual(r.lines, ['new: EarnKit Campaign #1 ($100 each to top 5 (in MINI))']);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: r.state, feeAlertedUsd: null }, f).lines, []);
  // opened_at stamped before checkedAt (a long sync transaction) still shows: ids, not time.
  assert.deepEqual(alertLines({ checkedAt: t(6), state: { top: {}, campaigns: [] }, feeAlertedUsd: null }, f).lines.length, 1);
  const quiet = alertLines({ checkedAt: null, state: null, feeAlertedUsd: null }, f);
  assert.deepEqual(quiet.lines, []);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: quiet.state, feeAlertedUsd: null }, f).lines, []);
});

test('token fees from $100, once per crossing; money lines first', () => {
  const f: AlertFacts = {
    ...empty,
    fees: { usd: 138, tokens: [{ url: 'https://tokens.fun/coin/0xabc', symbol: 'TIP' }] },
    prizes: [{ project_id: 1, name: 'Tip Jar', won: '$100 in MINI', prize_tx: '0x1', paid_at: t(5) }],
    newCampaigns: [{ id: 'c2', title: 'C2', prize: '$50 each to top 3 (in MINI)', opened_at: t(5) }],
  };
  const r = alertLines({ checkedAt: t(4), state: { top: {} }, feeAlertedUsd: null }, f);
  assert.deepEqual(r.lines, [
    'you won $100 in MINI with Tip Jar (basescan.org/tx/0x1)',
    'your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc)',
    'new: C2 ($50 each to top 3 (in MINI))',
  ]);
  assert.equal(r.feeAlertedUsd, 138);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: r.state, feeAlertedUsd: 138 }, f).lines, []);
  const two = { ...f, fees: { usd: 250, tokens: [{ url: 'https://tokens.fun/coin/0xa', symbol: 'A' }, { url: 'https://tokens.fun/coin/0xb', symbol: 'B' }] } };
  assert.match(alertLines({ checkedAt: t(6), state: r.state, feeAlertedUsd: null }, two).lines[0], /^your tokens have \$250 in fees to claim \(tokens\.fun\/coin\/0xa\)$/);
});

test('the daily-check offer never mentions tokens', () => {
  assert.doesNotMatch(SCHEDULE_NOTE, /token fee/i);
  assert.match(SCHEDULE_NOTE, /\(a win, a new campaign, your rank\)/);
});

test('sinceLine', () => {
  assert.equal(sinceLine([]), null);
  assert.equal(sinceLine(['a', 'b']), 'Since you last checked: a; b.');
});

// ---- Database (DATABASE_URL): the facts SQL, the memory, the offer, list_programs' order. ----

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const earnkit = {
  kind: 'earnkit',
  prize: { token: '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07', symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5,
  amount_each: '1000',
  prize_usd_total: 500,
  metric: 'unique_wallets',
  min_score: 10,
};
const sponsor = {
  kind: 'sponsor',
  prize: { token: '0x' + '2'.repeat(40), symbol: 'USDC', decimals: 6, chain_id: 8453 },
  pool: '1000',
  prize_total: '900',
  winners: 1,
  metric: 'unique_wallets',
  sponsor: { name: 'S' },
  criteria: 'x',
  escrow: '0x' + '3'.repeat(40),
  ref: '0x' + '1'.repeat(64),
};

/** Seeds programs, installations and entries under a unique tag; `run` gets their ids; cleans up. */
async function seeded(run: (s: { tag: string; me: number; other: number; wallet: string; addCampaign: (id: string) => Promise<void> }) => Promise<void>) {
  const tag = `test-alerts-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const wallet = `0xAbCdEf${Math.floor(Math.random() * 1e12).toString().padStart(12, '0')}${'0'.repeat(22)}`;
  const programs: string[] = [];
  const addProgram = async (id: string, c: object) => {
    programs.push(id);
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, campaign, ends_at, opened_at)
      VALUES (${id}, 'o', ${id}, 'd', 'https://x', 'https://x', 'r', '$500', 'active', 'unknown', ${sql().json(c as never)}, now() + interval '10 days', now())`;
  };
  await addProgram(`${tag}-ek`, earnkit);
  await addProgram(`${tag}-sp`, sponsor);
  const [me] = await sql()`INSERT INTO installations (token_hash) VALUES (${tag + '-me'}) RETURNING id`;
  const [other] = await sql()`INSERT INTO installations (token_hash) VALUES (${tag + '-other'}) RETURNING id`;
  try {
    await run({ tag, me: me.id, other: other.id, wallet, addCampaign: (id) => addProgram(id, earnkit) });
  } finally {
    await sql()`DELETE FROM projects WHERE program_id IN ${sql()(programs)}`;
    await sql()`DELETE FROM programs WHERE id IN ${sql()(programs)}`;
    await sql()`DELETE FROM installations WHERE id IN ${sql()([me.id, other.id])}`;
  }
}

test('alertFacts: EarnKit prizes only (Ruling 6), matched through installation_wallets in any case', db, async () => {
  await seeded(async ({ tag, me, other, wallet }) => {
    // Entered by another installation with a checksummed wallet this one later named.
    await sql()`
      INSERT INTO projects (program_id, name, installation_id, payout_wallet, score, prize_tx, prize_paid_at) VALUES
        (${tag + '-ek'}, 'EK win', ${other}, ${wallet}, 40, '0xek', now()),
        (${tag + '-sp'}, 'SP win', ${other}, ${wallet}, 40, '0xsp', now())`;
    assert.deepEqual((await alertFacts(me)).prizes, []);
    await rememberWallets(me, [wallet]);
    const f = await alertFacts(me);
    assert.deepEqual(f.prizes.map((p) => [p.name, p.won, p.prize_tx]), [['EK win', '$100 in MINI', '0xek']]);
    assert.deepEqual(f.standings.map((s) => [s.name, s.inTop]), [['EK win', true]]);
    // The wallet's old win shows once on this installation's next check.
    const first = await sinceYouLastChecked(me);
    assert.ok(first.lines.includes('you won $100 in MINI with EK win (basescan.org/tx/0xek)'));
    assert.ok(!(await sinceYouLastChecked(me)).lines.some((l) => l.startsWith('you won')));
  });
});

test('sinceYouLastChecked: the first check is quiet for campaigns, the next shows a new one; the offer only with offer, once', db, async () => {
  await seeded(async ({ tag, me, addCampaign }) => {
    const a = await sinceYouLastChecked(me);
    assert.ok(!a.lines.some((l) => l.startsWith('new:')));
    assert.equal(a.scheduleNote, null); // not offered outside list_programs
    await addCampaign(`${tag}-new`);
    const b = await sinceYouLastChecked(me, { offer: true });
    assert.ok(b.lines.includes(`new: ${tag}-new ($100 each to top 5 (in MINI))`));
    assert.equal(b.scheduleNote, SCHEDULE_NOTE);
    const c = await sinceYouLastChecked(me, { offer: true });
    assert.ok(!c.lines.some((l) => l.includes(`${tag}-new`)));
    assert.equal(c.scheduleNote, null);
  });
});

test('sinceYouLastChecked: over budget or row locked, no alerts and nothing marked seen', db, async () => {
  await seeded(async ({ tag, me, wallet }) => {
    await sql()`INSERT INTO projects (program_id, name, installation_id, payout_wallet, score, prize_tx, prize_paid_at)
      VALUES (${tag + '-ek'}, 'EK win', ${me}, ${wallet}, 40, '0xek', now())`;
    // Over budget: a facts read blocked past statement_timeout is cancelled by the server (57014).
    {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holder = sql().begin(async (tx) => {
        await tx`LOCK TABLE installation_wallets IN ACCESS EXCLUSIVE MODE`;
        locked();
        await held;
      });
      await isLocked;
      const started = Date.now();
      try {
        assert.deepEqual(await sinceYouLastChecked(me, { budgetMs: 100, otherWins: ['w'] }), { lines: ['w'], scheduleNote: null });
      } finally {
        release();
        await holder;
      }
      assert.ok(Date.now() - started < 1_000);
    }
    const [row] = await sql()`SELECT alerts_checked_at, alert_state FROM installations WHERE id = ${me}`;
    assert.deepEqual([row.alerts_checked_at, row.alert_state], [null, null]);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = sql().begin(async (tx) => {
      await tx`SELECT id FROM installations WHERE id = ${me} FOR UPDATE`;
      locked();
      await held;
    });
    await isLocked;
    const started = Date.now();
    assert.deepEqual((await sinceYouLastChecked(me)).lines, []);
    assert.ok(Date.now() - started < 1_500);
    release();
    await holder;
    assert.ok((await sinceYouLastChecked(me)).lines.includes('you won $100 in MINI with EK win (basescan.org/tx/0xek)'));
  });
});

test('sinceYouLastChecked: one connection per check, so more concurrent checks than the pool (5) all finish', db, async () => {
  const tag = `test-alerts-pool-${process.pid}-${Date.now()}`;
  const ids = (await sql()`
    INSERT INTO installations (token_hash) SELECT ${tag} || g FROM generate_series(1, 12) g RETURNING id`).map((r) => r.id as number);
  try {
    const started = Date.now();
    const results = await Promise.all(ids.map((id) => sinceYouLastChecked(id)));
    assert.equal(results.length, 12);
    assert.ok(Date.now() - started < 1_500, `took ${Date.now() - started} ms`);
    const rows = await sql()`SELECT count(*)::int AS n FROM installations WHERE id IN ${sql()(ids)} AND alerts_checked_at IS NOT NULL`;
    assert.equal(rows[0].n, 12); // every check committed: none starved into a timeout
  } finally {
    await sql()`DELETE FROM installations WHERE id IN ${sql()(ids)}`;
  }
});

test('list_programs: EarnKit wins, then sponsor wins, then other news (Ruling 26); wallet input is remembered', db, async () => {
  await seeded(async ({ tag, me, wallet, addCampaign }) => {
    await tools.list_programs({}, { installationId: me }); // the quiet first check
    await sql()`
      INSERT INTO projects (program_id, name, installation_id, payout_wallet, score, prize_tx, prize_paid_at) VALUES
        (${tag + '-ek'}, 'EK win', ${me}, ${wallet}, 40, '0xek', now()),
        (${tag + '-sp'}, 'SP win', ${me}, ${wallet}, 40, '0xsp', now())`;
    await addCampaign(`${tag}-new`);
    const other = '0x' + 'b'.repeat(40);
    const r = (await tools.list_programs({ wallet: other.toUpperCase().replace('0X', '0x') }, { installationId: me })) as {
      show_to_builder: string;
    };
    const head = r.show_to_builder.split('\n')[0];
    const at = (s: string) => head.indexOf(s);
    assert.ok(at('you won $100 in MINI with EK win') >= 0, head);
    assert.ok(at('you won 900 USDC with SP win') > at('you won $100 in MINI with EK win'), head);
    assert.ok(at(`new: ${tag}-new`) > at('you won 900 USDC with SP win'), head);
    const wallets = await sql()`SELECT wallet FROM installation_wallets WHERE installation_id = ${me}`;
    assert.deepEqual(wallets.map((w) => w.wallet), [other]);
  });
});
