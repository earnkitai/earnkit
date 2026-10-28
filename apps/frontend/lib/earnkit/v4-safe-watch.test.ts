import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import type { Mailer } from './digest';
import { CONTACT_EMAIL } from './policy';
import { SAFE_SWAP_URL, safeWatch } from './safe-watch';
import { gasAlerts, ownerGasMail } from './owner-mail';

/**
 * v4.0 Task 12: one email to the owner when EarnKit's Safe holds $5,000 or more (WETH and ETH on Base, priced with
 * cachedWethUsd), once per crossing (owner_alerts 'safe_5k'), and the gas-wallet-low email once a day per line.
 */
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const ETH = 10n ** 18n;
type Sent = Parameters<Mailer>[0];
const recorder = () => {
  const sent: Sent[] = [];
  const mail: Mailer = async (m) => {
    sent.push(m);
  };
  return { sent, mail };
};
/** The Safe holding `usd` at $2,000 a WETH, split 90% WETH and 10% ETH. */
const holding = (usd: number) => {
  const total = BigInt(Math.round((usd / 2000) * 1e6)) * 10n ** 12n;
  const weth = (total * 9n) / 10n;
  return { balances: async () => ({ weth, eth: total - weth }), price: async () => 2000 };
};
const NOW = new Date('2026-10-28T12:00:00Z');
const quiet = { log: () => {} };

beforeEach(async () => {
  process.env.RESEND_API_KEY = 're_test';
  if (process.env.DATABASE_URL) await sql()`DELETE FROM owner_alerts`;
});

test('(a) $4,999: nothing', db, async () => {
  const r = recorder();
  assert.equal(await safeWatch(NOW, { ...holding(4999), mail: r.mail, ...quiet }), 'below');
  assert.equal(r.sent.length, 0);
});

test('(b) $5,000: one mail with the amount and the swap link', db, async () => {
  const r = recorder();
  assert.equal(await safeWatch(NOW, { ...holding(5000), mail: r.mail, ...quiet }), 'sent');
  assert.equal(r.sent.length, 1);
  const m = r.sent[0];
  assert.equal(m.to, CONTACT_EMAIL);
  assert.equal(m.from, 'EarnKit <digest@earnkit.com>');
  assert.equal(m.subject, 'Your Safe holds $5,000');
  assert.equal(m.idempotencyKey, 'safe_5k:2026-10-28');
  assert.equal(SAFE_SWAP_URL, 'https://app.safe.global/swap?safe=base:0xc8A889577446153e28D42254B75238Ae31EC7D57');
  assert.equal(
    m.text,
    [
      "EarnKit's Safe on Base holds $5,000 (2.25 WETH and 0.25 ETH).",
      '',
      `Swap to USDC in your Safe: ${SAFE_SWAP_URL}`,
      '',
      'Then send the USDC to your Coinbase account.',
    ].join('\n'),
  );
  assert.ok(!/—/.test(m.text + m.subject), 'no em dashes');
});

test('the subject is whole dollars with separators', db, async () => {
  const r = recorder();
  await safeWatch(NOW, { balances: async () => ({ weth: 191n * 10n ** 16n, eth: 2n * 10n ** 16n }), price: async () => 2715.1, mail: r.mail, ...quiet });
  assert.equal(r.sent[0].subject, 'Your Safe holds $5,240');
  assert.ok(r.sent[0].text.startsWith("EarnKit's Safe on Base holds $5,240 (1.91 WETH and 0.02 ETH)."));
});

test('(c) the next run still above: nothing', db, async () => {
  const r = recorder();
  assert.equal(await safeWatch(NOW, { ...holding(5000), mail: r.mail, ...quiet }), 'sent');
  assert.equal(await safeWatch(new Date(NOW.getTime() + 3_600_000), { ...holding(6100), mail: r.mail, ...quiet }), 'already');
  assert.equal(r.sent.length, 1);
});

test('(d) drops to $3,000 then $5,200: one more mail', db, async () => {
  const r = recorder();
  await safeWatch(NOW, { ...holding(5000), mail: r.mail, ...quiet });
  const later = new Date('2026-11-02T12:00:00Z');
  assert.equal(await safeWatch(later, { ...holding(3000), mail: r.mail, ...quiet }), 'below');
  assert.equal(await safeWatch(later, { ...holding(5200), mail: r.mail, ...quiet }), 'sent');
  assert.equal(r.sent.length, 2);
  assert.equal(r.sent[1].subject, 'Your Safe holds $5,200');
  assert.equal(r.sent[1].idempotencyKey, 'safe_5k:2026-11-02');
});

test('(e) no Resend key: nothing sent, no throw, and the crossing still mails once the key is set', db, async () => {
  delete process.env.RESEND_API_KEY;
  const r = recorder();
  assert.equal(await safeWatch(NOW, { ...holding(5000), mail: r.mail, ...quiet }), 'skipped');
  assert.equal(r.sent.length, 0);
  process.env.RESEND_API_KEY = 're_test';
  assert.equal(await safeWatch(NOW, { ...holding(5000), mail: r.mail, ...quiet }), 'sent');
  assert.equal(r.sent.length, 1);
});

test('no price or a failed read: skipped, nothing sent, the state unchanged', db, async () => {
  const r = recorder();
  assert.equal(await safeWatch(NOW, { ...holding(9000), price: async () => null, mail: r.mail, ...quiet }), 'skipped');
  const failing = async () => {
    throw new Error('rpc down');
  };
  assert.equal(await safeWatch(NOW, { ...holding(9000), balances: failing, mail: r.mail, ...quiet }), 'skipped');
  assert.equal(r.sent.length, 0);
  assert.equal((await sql()`SELECT * FROM owner_alerts`).length, 0);
});

test('a failed send leaves it armed: the next run mails', db, async () => {
  const failing: Mailer = async () => {
    throw new Error('resend down');
  };
  assert.equal(await safeWatch(NOW, { ...holding(5000), mail: failing, ...quiet }), 'skipped');
  const r = recorder();
  assert.equal(await safeWatch(NOW, { ...holding(5000), mail: r.mail, ...quiet }), 'sent');
  assert.equal(r.sent.length, 1);
});

test('the gas-low mail goes once a day per line, naming the wallet', db, async () => {
  const r = recorder();
  const wallet = '0x1111111111111111111111111111111111111111';
  const alert = { line: 'bonus-ledger', wallet, chain: 'base' as const };
  assert.equal(await ownerGasMail(alert, NOW, r.mail), true);
  assert.equal(await ownerGasMail(alert, new Date(NOW.getTime() + 3_600_000), r.mail), false, 'same day: no second mail');
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].subject, "EarnKit's gas wallet is running low");
  assert.ok(r.sent[0].text.includes(wallet));
  assert.ok(r.sent[0].text.includes('Send it a little ETH on Base.'));
  assert.equal(r.sent[0].to, CONTACT_EMAIL);
  // Another line the same day mails on its own.
  assert.equal(await ownerGasMail({ line: 'deployer-gas:base', wallet, chain: 'base' }, NOW, r.mail), true);
  // The next day mails again.
  assert.equal(await ownerGasMail(alert, new Date('2026-10-29T09:00:00Z'), r.mail), true);
  assert.equal(r.sent.length, 3);
  const [row] = await sql()<{ state: string }[]>`SELECT state FROM owner_alerts WHERE kind = 'gas:bonus-ledger'`;
  assert.equal(row.state, '2026-10-29');
  delete process.env.RESEND_API_KEY;
  assert.equal(await ownerGasMail(alert, new Date('2026-10-30T09:00:00Z'), r.mail), false, 'no key: nothing, no throw');
  assert.equal(r.sent.length, 3);
});

test('gasAlerts: the bonus ledger gas line and each deployer-gas line, with their wallets', () => {
  const payout = '0x2222222222222222222222222222222222222222';
  const deployer = '0x3333333333333333333333333333333333333333';
  assert.deepEqual(gasAlerts(['bonus-ledger', 'deployer-gas:arc', 'deployer-gas:base', 'token-pending:3'], true, payout, deployer), [
    { line: 'bonus-ledger', wallet: payout, chain: 'base' },
    { line: 'deployer-gas:arc', wallet: deployer, chain: 'arc' },
    { line: 'deployer-gas:base', wallet: deployer, chain: 'base' },
  ]);
  assert.deepEqual(gasAlerts(['bonus-ledger'], false, payout, deployer), [], 'a bonus-ledger line for another reason is not a gas line');
  assert.deepEqual(gasAlerts(['bonus-ledger', 'deployer-gas:base'], true, null, null), [], 'no address: no mail');
});

test('runCron runs safe_watch (with its deps under `only`) and reports it', db, async () => {
  const { runCron } = await import('./cron');
  const r = recorder();
  const out = await runCron({ now: NOW, only: ['v4-safe-watch-none'], deps: { refreshFees: async () => 0, safeWatch: { ...holding(5100), mail: r.mail, ...quiet } } });
  assert.equal((out as { safe_watch?: string }).safe_watch, 'sent');
  assert.equal(r.sent.length, 1);
  const without = await runCron({ now: NOW, only: ['v4-safe-watch-none'], deps: { refreshFees: async () => 0 } });
  assert.equal((without as { safe_watch?: string }).safe_watch, undefined, 'tests without its deps never reach a chain');
});

test('(z) a price read that throws is skipped, never thrown', db, async () => {
  const r = recorder();
  const out = await safeWatch(NOW, {
    ...holding(9000),
    price: async () => {
      throw new Error('price down');
    },
    mail: r.mail,
    ...quiet,
  });
  assert.equal(out, 'skipped');
  assert.equal(r.sent.length, 0);
});
