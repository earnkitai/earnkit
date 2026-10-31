import { after, mock, test } from 'node:test';
import { walletOffered } from './fixtures/wallet-step';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { padPool } from './fixtures/rank-pool';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { APPLY_YES_NOTE, openGrant } from './bench-find';
import type { Card } from './present';
import { BASE_GRANTS_ID } from './builder-code';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { isoWeekOf } from './weeks';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v3.1 Task 16: the first-run journey through the real MCP layer (mcpCall), each reply in the owner-approved copy
 * (2026-10-21), word for word: signed out (step 1), signed in with no repo and a named repo (step 2), the first ranked
 * reply's connect offer with the Best fit (step 3), the connect yes that offers the draft (step 4), the draft (step 6),
 * the ship step, and Monday's moment (step 7). Each has at most one https link and exactly one question; points are
 * the ledger's.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-reply-copy-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// A Wednesday: the backfill's finished weeks are Oct 5, Sep 28 and Sep 21; Monday's moment is Oct 19.
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
/** Task 16: at most one https link, exactly one question, no em dash. */
const rule = (s: string) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—/, s);
  return s;
};

test('Task 16: the first-run journey, each reply word for word', db, async () => {
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);

  // Step 1: signed out, the first reply after install. The open grant is Base's (the program list's order: Base first).
  const t = `ek_v31rc_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c0 = (await connectInstallation(t))!;
  const none = (async () => ({ checked: 0, scored: 0, fits: [] })) as never;
  const s1 = rule(show(await mcpCall({ installationId: c0.id, ownInstallationId: c0.own, sharedClient: false, matchProjects: none }, 'find', {})));
  const signIn = links(s1)[0]!;
  assert.match(signIn, /^https:\/\/earnkit\.com\/signin\/[A-Za-z0-9_-]{22}$/);
  assert.equal(s1, [
    '**EarnKit gets you paid for building.**',
    '',
    'Every week I read what you ship, rank you against other builders, and find grants and programs you qualify for. Up to $5,000 is open from Base right now.',
    '',
    'Setup takes about a minute:',
    `1. Sign in with X: ${signIn}`,
    '2. Connect your code',
    '3. Add your wallet',
    '',
    'Done with step 1?',
  ].join('\n'));

  // Step 2: signed in, no repo (the picker), then a named repo the App can't count yet (its install link).
  const handle = `rc${RUN}`.slice(0, 15);
  assert.ok((await attachToX(c0.own, { id: `93${RUN}`, username: handle, name: 'Kit Builder', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `${handle}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: [{ program_id: BASE_GRANTS_ID, program: BASE_GRANTS_ID, status: 'likely', missing: [], effort: 'none', note: null }],
  }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  // v3.1 cold read: "You're in" only on the first reply after sign-in.
  // v4.0 approved copy 2: the welcome and step 2 alone (GitHub unknown: no Lovable or Bolt hint); a later day's full
  // pitch keeps the open grant's line before the GitHub step (GTM W2).
  const step2 = (link: string, first = false) => [
    ...(first ? [`You're in, @${handle}. Really glad you're here.`, ''] : ['Base Builder Grants pay up to $5,000 for apps on Base.']),
    `**Step 2 of 3:** connect your app's code on GitHub so I can match you to the right programs. Read-only, one click: ${link}`,
    '',
    'Done?',
  ].join('\n');
  const s2 = rule(show(await mcpCall({ ...ctx, matchProjects: none }, 'find', {})));
  assert.equal(s2, step2(links(s2)[0]!, true));
  assert.match(links(s2)[0]!, /^https:\/\/earnkit\.com\/github\/verify\?n=/);
  const r2b = await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const s2b = rule(show(r2b));
  // v3.1 answerable replies (spec 6): the same day, after the full pitch, the step is its link and question only.
  assert.equal(s2b, `Connect your app's code so I can match it (read-only, one click): ${links(s2b)[0]}\nDone?`);
  assert.equal((r2b.reply?.move_up as { kind: string }).kind, 'install_app');

  // The App connects the repo (code in each of the last 4 weeks): ranked, its finished weeks backfilled.
  const commits = [0, 1, 2, 3].map((w) => ({ sha: `c${w}`, message: `Ship feature ${w}`, date: new Date(Date.now() - w * 7 * DAY - DAY).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: 9401, owner: handle, installation: 94, commits } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  await sql()`UPDATE builder_projects SET link = 'https://kit.app' WHERE builder_id = ${c.id}`;

  // Step 3: the connect offer, with the Best fit and the points the yes adds (3 weeks at 30).
  const r3 = await mcpCall(ctx, 'find', {});
  const s3 = rule(show(r3));
  const [{ streak }] = await sql()<{ streak: number }[]>`SELECT streak FROM builder_projects WHERE builder_id = ${c.id}`;
  assert.ok(streak > 0, 'weeks in a row from the repo');
  assert.equal(s3, [
    `Kit is on the leaderboard: #1 of 13 builders, ${streak} weeks in a row.`,
    'You qualify for the Base Builder Grant Program, up to $5,000.',
    '',
    `Make your shipping log public on https://earnkit.com/${handle} so grant teams can see it?`,
  ].join('\n'));
  assert.equal((r3.reply?.move_up as { kind: string }).kind, 'connect');

  // Step 4: the yes posts them; the ledger's points; the Best fit offered as a draft (the apply ask, stored).
  const r4 = await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } });
  const s4 = rule(show(r4));
  assert.equal(s4, [
    `You're live: https://earnkit.com/${handle}`,
    'Next, I can write your Base Builder Grant Program application. You just check it and send.',
    'Want me to?',
  ].join('\n'));
  assert.deepEqual(r4.reply?.move_up && { ...(r4.reply.move_up as object), agent_note: undefined }, { kind: 'apply', project_key: key, agent_note: undefined });
  const [{ total }] = await sql()<{ total: number }[]>`SELECT COALESCE(sum(points), 0)::int AS total FROM builder_points WHERE builder_id = ${c.id}`;
  assert.equal(total, 90, 'the points are the ledger\'s');

  // Its yes drafts the application (step 6): no points line (no points for applying).
  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'apply', project_key: key, answer: 'yes' } });
  assert.equal(yes.reply?.agent_note, APPLY_YES_NOTE(BASE_GRANTS_ID));
  const answers = { project_name_description: 'Kit: fans tip creators onchain in one tap', live_product_url: 'https://kit.app', usage_numbers: '120 transactions in 90 days' };
  const s6 = rule(show(await mcpCall(ctx, 'prepare', { program_id: BASE_GRANTS_ID, project: { name: 'Kit', repo_url: `https://github.com/${key}`, live_url: 'https://kit.app' }, answers })));
  const lines6 = s6.split('\n');
  assert.equal(lines6[0], 'Your Base Builder Grant Program application is ready. I filled 4 of 16 answers from your work.');
  assert.match(lines6[1], /^You add \d+ more in the form: your full name, your email and \d+ short answers\.$/);
  assert.ok(s6.endsWith(`\n\nOpen the form, your answers are already in it: ${links(s6)[0]}\nSent it?`), s6);
  assert.doesNotMatch(s6, /points/);

  // The ship step: the Best fit, the one question, its points line (v3.1 cold read: the standing was just said in the
  // connect reply and hasn't changed, so it isn't repeated; the points line is this week's first).
  // v4.7.1 final review (R6): Base's application is drafted now, so it is never pitched again: the open grants instead.
  const s8 = rule(show(await mcpCall(ctx, 'find', {})));
  // v4.7.2 T1: the open paragraph leads with the total in grants and ends with the soonest open investment (live programs,
  // so the figure and the investment are matched by shape).
  assert.match(s8, /^Open now: (?:\$[\d.,]+[KM]?\+? in grants(?:\.|, plus [^\n]+ investment, [^\n]+?\.) )?Circle Developer Grants, \$5,000 to \$100,000 USDC grants, rolling\.\n/, s8);
  assert.equal(
    s8.slice(s8.indexOf('\n')),
    // v4.7 T4: the ship ask's why line in place of the points line, its own paragraph.
    '\n\nShipping this week keeps your 4-week streak and lifts your score.\n\nWant me to suggest one small thing to ship?',
  );

  // Step 7: Monday. Last week (Oct 12) ranked #1 of 13 and is week 4 in a row (code Sep 21 to Oct 17).
  mock.timers.setTime(Date.parse('2026-10-19T16:00:00Z'));
  const pads = await sql()<{ id: number }[]>`SELECT builder_id AS id FROM builder_live WHERE ranked AND builder_id <> ${c.id} AND formula = 'v2' AND score = 0`;
  for (const p of pads) await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
    VALUES (${p.id}, '2026-10-18', 0, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true) ON CONFLICT DO NOTHING`;
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
    VALUES (${c.id}, '2026-10-18', 40, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true) ON CONFLICT DO NOTHING`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, summary) VALUES (${c.id}, ${key}, '2026-10-12', ${sql().json({ checked: true, shipped_code: { n: 3 } } as never)}, 'Added tipping in one tap.')
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts, summary = EXCLUDED.summary`;
  const weeks = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'].map((d) => isoWeekOf(new Date(`${d}T12:00:00Z`)));
  await sql()`UPDATE builder_projects SET commit_weeks = ${weeks}::text[] WHERE builder_id = ${c.id}`;
  // Read just now (the daily read's), so this reply never re-reads GitHub (the fake is offline by now).
  await sql()`UPDATE builder_live SET read_at = ${new Date()} WHERE builder_id = ${c.id}`;
  await sql()`UPDATE source_live SET read_at = ${new Date()} WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${c.id})`;
  const r7 = await mcpCall(ctx, 'find', {});
  const s7 = rule(show(r7));
  // v3.1 one-tap posts (design 6): last week's post (4 in a row: the milestone shape) and its one-tap link (the reply's one
  // link); no points (owner ruling 5).
  const tap = links(s7)[0]!;
  assert.match(tap, new RegExp(`^https://earnkit\\.com/${handle}/post/[a-z2-7]{10}$`));
  // v4.0 Task 7 (approved copy 5): the Monday block; the summary the yes binds to, word for word, in the opener.
  assert.match(s7, new RegExp([
    '^Your week is ready, Kit\\. Added tipping in one tap\\. Nice work\\.',
    '',
    '\\| \\| This week \\|',
    '\\|---\\|---\\|',
    '\\| Shipping score \\| \\d+(, (up|down) \\d+)? \\|',
    '\\| Streak \\| 4 weeks \\|',
    '',
    `Your post is ready to share: ${tap.replace(/[.]/g, '\\.')}`,
    '',
    // v4.7.1 T1 fix round 1: no unapplied fit, so the Monday block carries money before its why; fix round 2 (R6): Base's
    // grant was drafted (the apply yes above), so never pitched: the open grants, without it.
    'Open now: (?:(?!Base Builder)[^\\n])+',
    '',
    'Builders who share wins get noticed by programs\\.',
    '',
    'Looks right\\?$',
  ].join('\n')), s7);
  assert.equal((r7.reply?.move_up as { kind: string; agent_note: string }).kind, 'share');
  assert.match((r7.reply?.move_up as { agent_note: string }).agent_note, /Show it exactly as given\. Never rewrite it\./);
});

test('Task 16 fix round 1: the signed-out reply\'s open grant is never an investment', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const card = (o: Partial<Card>): Card => ({ id: 'p', title: 'P', summary: '', tag: null, each_time: [], status: 'active', ...o });
  const batches = card({ id: 'batches', organizer: 'Base', chains: ['base'], max_award_usd: 100000, investment: true });
  const grant = card({ id: 'circle', organizer: 'Arc House (Circle)', any_chain: true, max_award_usd: 10000 });
  // Base first by the program list's order, but an investment: the grant is named, its organizer without the parenthesis.
  assert.deepEqual(openGrant([batches, grant], now, new Set()), { org: 'Arc House', amount: '$10,000', chain: null, name: 'P' });
  assert.equal(openGrant([batches], now, new Set()), null, 'only an investment open: no sentence');
  assert.deepEqual(openGrant([card({ id: 'base', organizer: 'Base', chains: ['base'], max_award_usd: 5000 }), grant], now, new Set()), { org: 'Base', amount: '$5,000', chain: 'Base', name: 'P' });
});
