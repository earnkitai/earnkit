import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person, withEnv } from './fixtures/find';
import { pathQuiet } from './fixtures/wallet-step';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { isoWeekOf, lastFinishedMonday } from './weeks';
import { setFeeSource } from './fees';
import { periodKey } from './free-tier';
import { CHEER_LINE, communityRow, mondayLines, mondayOpener, mondayRows } from './weekly-moment';
/** v4.7.1 T1 put the open grants paragraph before the why; v4.8 Task 1 retired it (the path names the money). */
const noOpen = (s: string) => {
  assert.doesNotMatch(s, /Open now:/, s);
  return s;
};
import { weekCommunityUsd } from './community';
import { MOMENT_ASK, mondayReply, type MomentView } from './bench-reply';
import { formatReply } from './reply-format';
import { digestBody, sendDigests, type DigestFacts, type Mailer } from './digest';

/**
 * v4.0 Task 7 (approved copy 5, "Every Monday"): the weekly reply and the Monday email: the week's opener, the table
 * (Shipping score, Streak, From your community) and the post link, with the builder's community support in plain
 * words (never the token's name).
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v4-weekly-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// Monday Oct 12, 16:15 UTC: after the weekly job's hour (the moment shows) and the email's (the email sends).
const MONDAY = Date.parse('2026-10-12T16:15:00Z');
mock.timers.enable({ apis: ['Date'], now: MONDAY });
after(async () => {
  mock.timers.reset();
  setFeeSource(null);
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const LAST = lastFinishedMonday(new Date(MONDAY));
const LAST_T = Date.parse(`${LAST}T00:00:00Z`);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const ctx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: NO_MATCH });
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const freshBoard = () => sql()`UPDATE builder_profiles SET hidden = true`;
/** $2,000 a WETH: 0.023 WETH is $46. */
const PRICE = 2000;
const wei = (usd: number) => ((BigInt(Math.round(usd * 1e6)) * 10n ** 18n) / BigInt(PRICE * 1e6)).toString();
const priced = () => setFeeSource({ availableWeth: async () => 0n, wethUsd: async () => PRICE });

async function claim(owner: string, usd: number, at: number, role = 'creator') {
  await sql()`INSERT INTO fee_claims (tx_hash, owner, role, weth, gas_wei, at)
    VALUES (${`0x${randomBytes(32).toString('hex')}`}, ${owner}, ${role}, ${wei(usd)}, 0, ${new Date(at)})`;
}
async function token(id: number, wallet: string | null) {
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, symbol, wallet) VALUES (${id}, ${`x${id}`}, 'launched', 'MAYA', ${wallet})`;
}
const newWallet = () => `0x${randomBytes(20).toString('hex')}`;

const NO_FEES = { usd: 0, lastWeekUsd: 0 };
const VIEW: MomentView = { week: 5, place: null, rank: 1, summary: 'Shipped the new meal planner.', post: { text: 'x', link: 'https://earnkit.com/maya/post/abcdefghij' }, first: 'Maya', score: 82, change: 4, community: { usd: 46, lastWeekUsd: 30 } };
const PAGE = 'https://earnkit.com/maya';

test('communityRow: none under $1; whole dollars; the cheer at $100 or double a real last week', () => {
  assert.equal(communityRow(0, 0), null);
  assert.equal(communityRow(0.6, 0), null, 'under $1 counts as $0');
  assert.deepEqual(communityRow(12, 0), { cell: '$12, already in your wallet', cheer: false });
  assert.deepEqual(communityRow(100, 0), { cell: '$100, already in your wallet', cheer: true });
  assert.deepEqual(communityRow(60, 25), { cell: '$60, already in your wallet', cheer: true });
  assert.deepEqual(communityRow(60, 0), { cell: '$60, already in your wallet', cheer: false });
  assert.deepEqual(communityRow(60, 31), { cell: '$60, already in your wallet', cheer: false });
  assert.deepEqual(communityRow(1240.4, 2000), { cell: '$1,240, already in your wallet', cheer: true });
  assert.deepEqual(communityRow(5, 0.4), { cell: '$5, already in your wallet', cheer: false }, 'a last week under $1 is $0');
});

test('the rows: score with its change, the streak, the community', () => {
  const f = { score: 82, change: 4, streak: 5, usd: 46, lastWeekUsd: 0 };
  assert.deepEqual(mondayRows(f), [['Shipping score', '82, up 4'], ['Streak', '5 weeks'], ['From your community', '$46, already in your wallet']]);
  assert.deepEqual(mondayRows({ ...f, change: -3, streak: 1, usd: 0 }), [['Shipping score', '82, down 3'], ['Streak', '1 week']]);
  assert.deepEqual(mondayRows({ ...f, change: 0, streak: 0, usd: 0 }), [['Shipping score', '82']]);
  assert.deepEqual(mondayRows({ ...f, change: null, streak: 0, usd: 0 }), [['Shipping score', '82']]);
  assert.equal(mondayOpener('Maya', 'Shipped the new meal planner.'), 'Your week is ready, Maya. You shipped the new meal planner. Nice work.');
  assert.equal(mondayOpener('Maya', null), 'Your week is ready, Maya. You shipped this week. Nice work.');
  assert.equal(mondayOpener('Sam', 'Fixed the login loop.'), 'Your week is ready, Sam. Fixed the login loop. Nice work.', 'the approved words as they are');
});

test('(a) the reply is the spec block: opener, table, post link, the page question', () => {
  const s = mondayReply(VIEW, PAGE, MOMENT_ASK);
  assert.equal(s, [
    'Your week is ready, Maya. You shipped the new meal planner. Nice work.',
    '',
    '| | This week |',
    '|---|---|',
    '| Shipping score | 82, up 4 |',
    '| Streak | 5 weeks |',
    '| From your community | $46, already in your wallet |',
    '',
    'Your post is ready to share: https://earnkit.com/maya/post/abcdefghij',
    '',
    'Add this week to your page?',
  ].join('\n'));
  assert.equal(MOMENT_ASK, 'Add this week to your page?');
  assert.equal(links(s).length, 1);
  assert.equal(questions(s), 1);
  assert.doesNotMatch(s, /MAYA|[Tt]oken|[Cc]oin|\p{Extended_Pictographic}|—/u);
  // Plain surfaces (Task 6): "Label: value" lines.
  assert.match(formatReply(s, 'plain'), /\n\nShipping score: 82, up 4\n\nStreak: 5 weeks\n\nFrom your community: \$46, already in your wallet\n\n/);
  // No post: the page is the one link.
  assert.match(mondayReply({ ...VIEW, post: null }, PAGE, MOMENT_ASK), /\n\nYour page: https:\/\/earnkit\.com\/maya\n\nAdd this week to your page\?$/);
});

test('(b) $0 from the community: no community row', () => {
  const s = mondayReply({ ...VIEW, community: NO_FEES }, PAGE, MOMENT_ASK);
  assert.doesNotMatch(s, /community|wallet|believe/i, s);
  assert.match(s, /\| Streak \| 5 weeks \|\n\nYour post/);
});

test('(c) $340: the row and the cheer under the table', () => {
  const s = mondayReply({ ...VIEW, community: { usd: 340, lastWeekUsd: 300 } }, PAGE, MOMENT_ASK);
  assert.match(s, /\| From your community \| \$340, already in your wallet \|\n\nPeople really believe in what you're shipping\.\n\nYour post is ready/);
  assert.equal(CHEER_LINE, "People really believe in what you're shipping.");
  assert.equal(questions(s), 1);
});

test('(d) the email carries the same facts as plain lines', () => {
  const lines = mondayLines({ first: 'Maya', summary: 'Shipped the new meal planner.', score: 82, change: 4, streak: 5, usd: 340, lastWeekUsd: 0 });
  assert.deepEqual(lines, [
    'Your week is ready, Maya. You shipped the new meal planner. Nice work.',
    '',
    'Shipping score: 82, up 4',
    'Streak: 5 weeks',
    'From your community: $340, already in your wallet',
    CHEER_LINE,
  ]);
  const base: DigestFacts = { money: [], newPrograms: [], wins: [], deadlines: [], week: null, handle: null };
  const week = { lines, standing: { score: 82, rank: 1, total: 1 }, approveUrl: 'https://earnkit.com/api/week?t=a', hideUrl: 'https://earnkit.com/api/week?t=h', approved: false };
  const b = digestBody({ ...base, week })!;
  assert.equal(b.subject, 'Your week on EarnKit: Shipping 82', 'the subject unchanged');
  assert.equal(b.text, [...lines, '', 'Looks right: https://earnkit.com/api/week?t=a', 'Hide this week: https://earnkit.com/api/week?t=h'].join('\n'));
  const done = digestBody({ ...base, week: { ...week, approved: true, postUrl: 'https://earnkit.com/maya/post/abcdefghij' } })!;
  assert.ok(done.text.endsWith('\nYour post is ready to share: https://earnkit.com/maya/post/abcdefghij'), done.text);
  assert.doesNotMatch(`${b.text}\n${done.text}`, /\|/, 'no table syntax in a plain email');
});

test('weekCommunityUsd: the creator fees claimed to the token wallet in the week and the week before, priced in USD', db, async () => {
  priced();
  const id = await person({ projects: [] });
  const wallet = newWallet();
  await token(id, wallet);
  // In the week (one row written checksummed, another case), the week before, and what never counts.
  await claim(wallet.toUpperCase().replace(/^0X/, '0x'), 30, LAST_T + 2 * DAY);
  await claim(wallet, 16, LAST_T + 7 * DAY - 1000);
  await claim(wallet, 25, LAST_T - 3 * DAY);
  await claim(wallet, 999, LAST_T + 7 * DAY, 'creator'); // the running week
  await claim(wallet, 999, LAST_T + 2 * DAY, 'safe');
  await claim(newWallet(), 999, LAST_T + 2 * DAY);
  const r = await weekCommunityUsd(id, new Date(LAST_T), new Date());
  assert.ok(Math.abs(r.usd - 46) < 1e-6, String(r.usd));
  assert.ok(Math.abs(r.lastWeekUsd - 25) < 1e-6, String(r.lastWeekUsd));
  // No token, or a token with no wallet: nothing.
  assert.deepEqual(await weekCommunityUsd(await person({ projects: [] }), new Date(LAST_T), new Date()), NO_FEES);
  const bare = await person({ projects: [] });
  await token(bare, null);
  assert.deepEqual(await weekCommunityUsd(bare, new Date(LAST_T), new Date()), NO_FEES);
  // No price: 0, logged, never a wrong number.
  const errors = mock.method(console, 'error', () => {});
  try {
    assert.deepEqual(await weekCommunityUsd(id, new Date(LAST_T), new Date(), async () => null), NO_FEES);
    assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('[community]')), 'logged');
  } finally {
    errors.mock.restore();
  }
});

/** A ranked builder named Maya Lin: Shipping 78 the week before last, 82 last week, code 5 weeks in a row. */
async function maya(tag: string) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, seen: { connect_done: '2026-09-01T00:00:00.000Z' }, projects: [{ key, name: 'App', confirmed: true }] });
  await sql()`UPDATE builder_profiles SET x_name = 'Maya Lin' WHERE builder_id = ${id}`;
  for (const [day, score] of [[ymd(LAST_T - DAY), 78], [ymd(LAST_T + 6 * DAY), 82]] as const)
    await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
      VALUES (${id}, ${day}, ${score}, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true)`;
  await sql()`UPDATE builder_projects SET commit_weeks = ${[1, 2, 3, 4, 5].map((i) => isoWeekOf(new Date(MONDAY - i * 7 * DAY))).sort()}::text[] WHERE builder_id = ${id}`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) SELECT id, '{"private": false}'::jsonb, true, now() FROM builder_sources WHERE builder_id = ${id}`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, titles, summary)
    VALUES (${id}, ${key}, ${LAST}, ${sql().json({ checked: true, shipped_code: { n: 4 } } as never)}, ${['Add the new meal planner']}::text[], 'Shipped the new meal planner.')`;
  const wallet = newWallet();
  await token(id, wallet);
  await claim(wallet, 46, LAST_T + 3 * DAY);
  await claim(wallet, 40, LAST_T - 3 * DAY);
  // v4.8 Task 1: the Monday block is one of the older ranked replies, after the path has no program to name.
  await pathQuiet(id);
  return { id, key, handle };
}

test('(a, end to end) the Monday find: the spec block with the real score, streak, community and post link', db, async () => {
  priced();
  await freshBoard();
  const me = await maya('v4wk');
  const s = show(await mcpCall(ctx(me.id), 'find', {}));
  const link = links(s)[0] ?? '';
  assert.match(link, new RegExp(`^https://earnkit\\.com/${me.handle}(/post/[a-z2-7]{10})?$`), s);
  const share = link.includes('/post/') ? `Your post is ready to share: ${link}` : `Your page: ${link}`;
  assert.equal(noOpen(s), [
    'Your week is ready, Maya. You shipped the new meal planner. Nice work.',
    '',
    '| | This week |',
    '|---|---|',
    '| Shipping score | 82, up 4 |',
    '| Streak | 5 weeks |',
    '| From your community | $46, already in your wallet |',
    '',
    share,
    '',
    'Builders who share wins get noticed by programs.',
    '',
    'Add this week to your page?',
  ].join('\n'));
  assert.equal(links(s).length, 1);
  assert.equal(questions(s), 1);
  assert.doesNotMatch(s, /MAYA|[Tt]oken|[Cc]oin|believe/, 'never the token, and $46 against $40 is no cheer');
});

test('(d, end to end) the Monday email carries the same facts as plain lines', db, () =>
  withEnv({ RESEND_API_KEY: 're_test_never_used' }, async () => {
    priced();
    await freshBoard();
    await sql()`DELETE FROM free_tier_usage WHERE (name = 'resendDay' AND period = ${periodKey('day', new Date(MONDAY))})
      OR (name = 'resendMonth' AND period = ${periodKey('month', new Date(MONDAY))})`;
    const me = await maya('v4em');
    await sql()`INSERT INTO digest_subscriptions (installation_id, email, asked_at, opted_in_at)
      VALUES (${me.id}, ${`v4em${me.id}@example.com`}, ${new Date(MONDAY - 8 * DAY)}, ${new Date(MONDAY - 7 * DAY)})`;
    const sent: Parameters<Mailer>[0][] = [];
    const r = await sendDigests(new Date(), { mail: async (m) => void sent.push(m), only: [me.id] });
    assert.equal(r.sent, 1);
    const m = sent[0]!;
    // v4.7 T5 (R16): the standing on top carries the one score; the subject and the week block carry none.
    assert.equal(m.subject, 'Your week on EarnKit');
    // Final review 9: a score of 0 is said as no part (the streak leads the standing).
    assert.match(m.text, /^(?:Score [1-9]\d*\. )?5 weeks shipping in a row\./, m.text);
    assert.ok(m.text.includes([
      'Your week is ready, Maya. You shipped the new meal planner. Nice work.',
      '',
      'Streak: 5 weeks',
      'From your community: $46, already in your wallet',
      '',
      'Looks right: ',
    ].join('\n')), m.text);
    assert.match(m.text, /\nHide this week: https:\/\/earnkit\.com\/api\/week\?t=\S+/);
    assert.match(m.text, /Deadline alerts and a Monday summary\. Unsubscribe: https:\/\/earnkit\.com\/api\/digest\/unsubscribe\?t=/);
    assert.doesNotMatch(m.text, /MAYA|[Tt]oken\b|[Cc]oin|\|/);
  }),
);
