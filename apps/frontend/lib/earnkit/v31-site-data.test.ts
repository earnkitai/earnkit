import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { streakWeeks } from './site-streak';
import { sql } from './db';
import { WEEKLY_STREAK, benchCardFacts, benchRows, profileData, type ProfileData } from './bench-data';
import { builderJson } from './builder-json';
import { shipLogFacts } from './ship-log-facts';
import { streakOfBuilder, streaksFor } from './streak';
import { PRIVATE_NAME, projectPrograms, projectProgramsDated, safeNames, siteName } from './page-data';
import { person, withEnv } from './fixtures/find';
import { padPool } from './fixtures/rank-pool';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { readGuideIds } from './landing';
import { last52, mondayOfWeek, isoWeekOf } from './weeks';
import { BASE_GENESIS_UNIX, backerWeeks, highlights, lastShippedAt, profileSite, standingPill, thisWeekCommits, tokenAllowed } from './site-data';

/** v3.1 site Task 3: the profile's reads (last shipped, this week, Highlights, the standing pill, backer weeks, the Token card guard). */

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});

const NOW = new Date('2026-10-21T12:00:00Z');
const DAY = 86_400_000;
const RUN = randomBytes(2).toString('hex');
let n = 0;

type B = { id: number; key: string };
/**
 * A claimed person whose one project is `key` (find.ts person: a confirmed project gets its verified repo source), with
 * its chains, commit weeks, the repo proof, the claim date and, unless `hidden`, a public repo reading carrying `signals`.
 */
async function builder(o: {
  key?: string; name?: string; what?: string | null; link?: string | null; chains?: string[]; commitWeeks?: string[]; confirmed?: boolean; proof?: string;
  claimedAt?: Date; score?: number; ranked?: boolean; signals?: Record<string, unknown>; hidden?: boolean; source?: boolean;
} = {}): Promise<B> {
  n++;
  const key = o.key ?? `s${RUN}o${n}/app${n}`;
  const id = await person({ projects: [{ key, name: o.name ?? `App ${n}`, what: o.what ?? null, confirmed: o.confirmed ?? true }], main: key, claimed: `s${RUN}${n}`, score: o.score ?? 50, ranked: o.ranked ?? false });
  await sql()`UPDATE builder_profiles SET claimed_at = ${o.claimedAt ?? new Date(NOW.getTime() - 200 * DAY)}, x_name = 'Sam Lee' WHERE builder_id = ${id}`;
  await sql()`UPDATE builder_projects SET chains = ${o.chains ?? []}, commit_weeks = ${o.commitWeeks ?? []}, link = ${o.link ?? null} WHERE builder_id = ${id}`;
  if (o.source && !(o.confirmed ?? true))
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at) VALUES (${id}, 'repo', ${key}, ${key}, 'proof_line', 'verified', 'agent', now())`;
  if (o.proof) await sql()`UPDATE builder_sources SET proof = ${o.proof} WHERE builder_id = ${id} AND kind = 'repo'`;
  if (!o.hidden) await reading(id, o.signals ?? {});
  return { id, key };
}
/** The repo source's live reading: public, plus `signals`. */
async function reading(id: number, signals: Record<string, unknown>) {
  await sql()`
    INSERT INTO source_live (source_id, signals, ok, read_at)
    SELECT id, ${sql().json({ private: false, ...signals } as never)}, true, now() FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo'
    ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals, read_at = EXCLUDED.read_at`;
}
const page = async (id: number, o: { only?: number[] } = {}) => (await profileData(id, NOW, o)) as ProfileData;

test('(a) lastShippedAt reads pushed_at from the ship reading; null with no verified repo, a future pushed_at, or an unconfirmed project', db, async () => {
  const at = '2026-10-21T10:00:00Z';
  const b = await builder({ signals: { pushed_at: at } });
  assert.equal((await lastShippedAt(b.id, NOW))?.toISOString(), new Date(at).toISOString());
  assert.equal((await profileSite(b.id, await page(b.id), NOW)).lastShippedAt, new Date(at).toISOString());
  // No verified repo: the project is not confirmed and has no repo source.
  const none = await builder({ confirmed: false });
  assert.equal(await lastShippedAt(none.id, NOW), null);
  const future = await builder({ signals: { pushed_at: '2026-10-22T10:00:00Z' } });
  assert.equal(await lastShippedAt(future.id, NOW), null);
  const garbage = await builder({ signals: { pushed_at: 'yesterday' } });
  assert.equal(await lastShippedAt(garbage.id, NOW), null);
  // A verified repo source but the project itself not confirmed.
  const unconfirmed = await builder({ confirmed: false, source: true, signals: { pushed_at: at } });
  assert.equal(await lastShippedAt(unconfirmed.id, NOW), null);
});

test('(b) thisWeekCommits returns this ISO week\'s count and 0 for a week weekCounts refuses', db, async () => {
  const week = isoWeekOf(NOW);
  const b = await builder({ signals: { commit_counts: { [week]: 14, '2026-W01': 3 }, pushes_checked: true, created_at: '2025-01-01T00:00:00Z' } });
  assert.equal(await thisWeekCommits(b.id, NOW), 14);
  // profileSite reads the same ship reading once for both.
  const s = await profileSite(b.id, await page(b.id), NOW);
  assert.equal(s.thisWeek, 14);
  assert.equal(s.lastShippedAt, null);
  // The repo was created after this week (backdated counts): refused.
  const later = await builder({ signals: { commit_counts: { [week]: 9 }, pushes_checked: true, created_at: new Date(NOW.getTime() + 10 * DAY).toISOString() } });
  assert.equal(await thisWeekCommits(later.id, NOW), 0);
  const none = await builder({ confirmed: false });
  assert.equal(await thisWeekCommits(none.id, NOW), 0);
});

/** A verified site source of the project, its daily readings (`up` per day). */
async function site(b: B, ref: string, days: [string, boolean][]) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
    VALUES (${b.id}, 'site', ${ref}, ${b.key}, 'repo_link', 'verified', 'agent', now()) RETURNING id`;
  for (const [day, up] of days) await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${id}, ${day}, ${sql().json({ up } as never)}, true)`;
}
const addr = () => `0x${randomBytes(20).toString('hex')}`;

/** `n` consecutive daily readings of a site ending at `last` (YYYY-MM-DD), up unless the index is in `down`. */
const daysUp = (last: string, n: number, down: number[] = []): [string, boolean][] =>
  Array.from({ length: n }, (_, i) => [new Date(Date.parse(`${last}T00:00:00Z`) - (n - 1 - i) * DAY).toISOString().slice(0, 10), !down.includes(i)]);
const tx = () => `0x${randomBytes(32).toString('hex')}`;
/** A Bench-confirmed Base project proven through the App, a public repo reading created `created` with `commits` in the year. */
const baseBuilder = (o: { key?: string; name?: string; hidden?: boolean; created?: string; commits?: number; branch?: string } = {}) =>
  builder({
    key: o.key, name: o.name, hidden: o.hidden, chains: ['base'], proof: 'github_app',
    signals: { created_at: o.created ?? '2025-03-04T10:00:00Z', commits_year: o.commits ?? 312, default_branch: o.branch ?? 'main' },
  });

/** A proven wallet of the builder with its wallet_contracts rows ([chain, created_at, counts]); returns the addresses. */
async function walletContracts(b: B, rows: [string, string | null, boolean][]): Promise<string[]> {
  const wallet = addr();
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${wallet}, ${b.id})`;
  const out: string[] = [];
  for (const [chain, at, counts] of rows) {
    const a = addr();
    out.push(a);
    await sql()`INSERT INTO wallet_contracts (chain, address, wallet, created_at, counts) VALUES (${chain}, ${a}, ${wallet}, ${at}, ${counts})`;
  }
  return out;
}
/** The builder's proven GitHub login (set only from a verified source) and when GitHub says the account was made. */
async function githubSince(b: B, created: string): Promise<string> {
  const login = `s${RUN}gh${randomBytes(3).toString('hex')}`;
  await sql()`UPDATE builder_profiles SET github_login = ${login} WHERE builder_id = ${b.id}`;
  await sql()`INSERT INTO github_users (login, created_at) VALUES (${login}, ${created}) ON CONFLICT (login) DO UPDATE SET created_at = EXCLUDED.created_at`;
  return login;
}
/** A won program for the builder's project (an announced outcome on an entry), its guide id when `guide`. */
async function won(b: B, id: string, title: string, at: string) {
  await upsertProgram(ProgramFile.parse({ ...committedProgram('alliance-all19'), id, title }));
  await sql()`INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id, submitted_at) VALUES (${id}, 'Kit', ${`https://github.com/${b.key}`}, ${b.key}, ${b.id}, ${at})`;
  const [{ id: pid }] = await sql()<{ id: number }[]>`SELECT id FROM projects WHERE program_id = ${id} AND installation_id = ${b.id}`;
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis) VALUES (${pid}, ${id}, 'r1', 'won', 'announcement')`;
}

test('(c) Highlights, v3.1 competence: live, contracts on every chain, products, consistency, won; each links its proof, in that order', db, async () => {
  const b = await builder({ name: 'Kit', chains: ['base'], proof: 'github_app', commitWeeks: last52(NOW).slice(-6), signals: { created_at: '2025-03-04T10:00:00Z', commits_year: 312, default_branch: 'main' } });
  await site(b, 'https://www.kit.example', daysUp('2026-10-21', 30, [3, 17]));
  // A second product of another project, up before the first: products lists it first.
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
    VALUES (${b.id}, 'site', 'https://tip.example', 'tip.example', 'earnkit_txt', 'verified', 'agent', now())`;
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) SELECT id, '2025-01-05', '{"up":true}'::jsonb, true FROM builder_sources WHERE builder_id = ${b.id} AND ref = 'https://tip.example'`;
  const [, first] = await walletContracts(b, [['base', '2025-06-10T00:00:00Z', true], ['ethereum', '2024-03-01T00:00:00Z', true], ['base', '2023-01-01T00:00:00Z', false]]);
  // The old rows' sources never count any more: a verified Base contract source, an EarnKit deploy, a found Builder Code.
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, deployed_at) VALUES
    (${b.id}, 'contract', ${`base:${addr()}`}, ${b.key}, 'deployer', 'verified', 'agent', '2025-06-10T00:00:00Z')`;
  await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, address, status, cost_micro_usd, created_at) VALUES
    (${b.id}, 'k', ${b.key}, 'base', ${tx()}, ${addr()}, 'deployed', 0, '2026-02-01T00:00:00Z')`;
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at, path) VALUES (${b.key}, true, ${NOW}, 'src/onchain/tx.ts')`;
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'alliance-all19', 'applied', '2026-10-14T09:00:00Z')`;
  const camp = `v31-site-${process.pid}-c-won`;
  await won(b, camp, `Won program ${RUN}`, '2026-09-02T10:00:00Z');
  await githubSince(b, '2019-03-01T00:00:00Z');
  const [owner, repo] = b.key.split('/');
  const h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h, [
    { icon: 'live', title: 'Live at kit.example', sub: 'Up 28 of the last 30 days checked', href: 'https://www.kit.example' },
    { icon: 'contract', title: '2 contracts on 2 chains', sub: 'Since Mar 2024', href: `https://etherscan.io/address/${first}` },
    { icon: 'products', title: 'Shipped 2 products', sub: 'tip.example, kit.example', href: 'https://tip.example' },
    { icon: 'consistency', title: 'Shipped in 6 of the last 52 weeks', sub: 'Building Kit since Mar 2025', href: `https://github.com/${owner}/${repo}` },
    { icon: 'won', title: `Won Won program ${RUN}`, sub: 'Sep 2026', href: `/programs/${camp}` },
  ]);
  // Owner rulings: never anything coin related, no Base-only rows, no commit count, no "Applied to".
  assert.doesNotMatch(JSON.stringify(h), /Builder Code|On Base since|Wallet proven|commit|Applied to|coin|token|fees|backer/i);
});

test('(c2) Highlights presence: uptime only from 7 days read, contracts counted only, products from 2, no Base-only rows, never "in a row"', db, async () => {
  // Six readings: since the first up day.
  const b = await baseBuilder({ created: '2026-05-02T00:00:00Z', commits: 1 });
  await site(b, 'https://kit.example', daysUp('2026-10-21', 6));
  await walletContracts(b, [['base', '2026-05-10T00:00:00Z', true]]);
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at, path) VALUES (${b.key}, true, ${NOW}, 'a.ts')`;
  const h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h.map((x) => [x.icon, x.title, x.sub]), [
    ['live', 'Live at kit.example', 'Since Oct 2026'],
    ['contract', '1 contract on Base', 'Since May 2026'],
  ], 'one product is the live item; no week with code, no consistency; never the Builder Code');
  // Fix round 1 (uptime honesty): only days EarnKit read count. Seven read over ten days, one down, one a failed read
  // (not a read): up 6 of the 7 checked; older readings fall outside the 30 days.
  const seven = await baseBuilder();
  await site(seven, 'https://seven.example', [['2026-08-01', true], ['2026-10-11', true], ['2026-10-12', false], ['2026-10-14', true], ['2026-10-16', true], ['2026-10-17', true], ['2026-10-19', true], ['2026-10-20', true]]);
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) SELECT id, '2026-10-18', '{}'::jsonb, false FROM builder_sources WHERE builder_id = ${seven.id} AND kind = 'site'`;
  assert.equal((await highlights(seven.id, await page(seven.id), NOW))[0].sub, 'Up 6 of the last 7 days checked');
  // Install fixes: a failed read (ok false) on the newest day is EarnKit's failure, not the site's: the newest ok
  // reading decides, so a site up at its last real read stays live.
  const flaky = await baseBuilder();
  await site(flaky, 'https://flaky.example', daysUp('2026-10-20', 8));
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) SELECT id, '2026-10-21', '{}'::jsonb, false FROM builder_sources WHERE builder_id = ${flaky.id} AND kind = 'site'`;
  assert.deepEqual((await highlights(flaky.id, await page(flaky.id), NOW))[0], { icon: 'live', title: 'Live at flaky.example', sub: 'Up 8 of the last 8 days checked', href: 'https://flaky.example' });
  // Only failed reads: no item (nothing EarnKit read says it is up), and no product either.
  const unread = await baseBuilder();
  await site(unread, 'https://unread.example', []);
  await site(unread, 'https://other.example', daysUp('2026-10-21', 2));
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) SELECT id, '2026-10-21', '{"up":true}'::jsonb, false FROM builder_sources WHERE builder_id = ${unread.id} AND ref = 'https://unread.example'`;
  const hu = await highlights(unread.id, await page(unread.id), NOW);
  assert.deepEqual(hu.map((x) => x.title), ['Live at other.example'], 'a site never read up is not a product');
  // Fix round 1: a site down at its newest ok reading is no live item (it read up before), yet it shipped: a product.
  const down = await baseBuilder();
  await site(down, 'https://down.example', [...daysUp('2026-10-20', 20), ['2026-10-21', false]]);
  assert.ok(!(await highlights(down.id, await page(down.id), NOW)).some((x) => x.icon === 'live'));
  // A second site of the project, up at its newest reading, is the item then; both are products, oldest first.
  await site(down, 'https://up.example', daysUp('2026-10-21', 3));
  const hd = await highlights(down.id, await page(down.id), NOW);
  assert.deepEqual(hd[0], { icon: 'live', title: 'Live at up.example', sub: 'Since Oct 2026', href: 'https://up.example' });
  assert.deepEqual(hd[1], { icon: 'products', title: 'Shipped 2 products', sub: 'down.example, up.example', href: 'https://down.example' });
  // Contracts: a token or an unused one (counts false) never counts; one chain names it, several count them; another
  // builder's wallet never counts here.
  const chains = await baseBuilder();
  await walletContracts(chains, [['arbitrum', '2025-02-01T00:00:00Z', true], ['arbitrum', '2024-01-01T00:00:00Z', false], ['arbitrum', null, true]]);
  await walletContracts(await baseBuilder(), [['base', '2025-01-01T00:00:00Z', true]]);
  const one = (await highlights(chains.id, await page(chains.id), NOW)).find((x) => x.icon === 'contract');
  assert.deepEqual([one?.title, one?.sub], ['2 contracts on Arbitrum', 'Since Feb 2025']);
  await walletContracts(chains, [['optimism', '2024-06-01T00:00:00Z', true]]);
  const several = (await highlights(chains.id, await page(chains.id), NOW)).find((x) => x.icon === 'contract');
  assert.deepEqual([several?.title, several?.sub, several?.href?.startsWith('https://optimistic.etherscan.io/address/0x')], ['3 contracts on 2 chains', 'Since Jun 2024', true]);
  // A proven wallet with no counted contract: no contract row ("On Base since" and "Wallet proven by signature" are gone).
  const bare = await baseBuilder();
  await sql()`INSERT INTO person_wallets (wallet, builder_id, base_since) VALUES (${addr()}, ${bare.id}, '2025-11-26T15:58:43Z')`;
  await walletContracts(bare, [['base', '2025-01-01T00:00:00Z', false]]);
  const hb = await highlights(bare.id, await page(bare.id), NOW);
  assert.ok(!hb.some((x) => x.icon === 'contract'));
  assert.doesNotMatch(JSON.stringify(hb), /On Base since|Wallet proven/);
  // The Streak card owns the run of weeks: Highlights never repeats it, and never says "Deployed by the project".
  const streaky = await builder({ commitWeeks: last52(NOW).slice(-5), signals: { created_at: '2025-01-01T00:00:00Z' } });
  const hs = await highlights(streaky.id, await page(streaky.id), NOW);
  assert.deepEqual(hs.find((x) => x.icon === 'consistency')?.title, 'Shipped in 5 of the last 52 weeks');
  for (const x of hs) assert.doesNotMatch(`${x.title} ${x.sub}`, /in a row|Shipping since|Deployed by the project/);
  // A confirmed project with none of the rows yet (no reading, no week with code): on EarnKit since the claim.
  const quiet = await builder({ hidden: true, claimedAt: new Date('2026-03-02T00:00:00Z') });
  assert.deepEqual(await highlights(quiet.id, await page(quiet.id), NOW), [{ icon: 'start', title: 'On EarnKit since Mar 2', sub: 'On the leaderboard' }]);
  // No project at all.
  const none = await person({ projects: [], claimed: `s${RUN}bare` });
  await sql()`UPDATE builder_profiles SET claimed_at = '2026-10-02T08:00:00Z' WHERE builder_id = ${none}`;
  assert.deepEqual(await highlights(none, await page(none), NOW), [{ icon: 'start', title: 'On EarnKit since Oct 2', sub: 'No project on the leaderboard yet' }]);
  // A project not confirmed yet is not on the leaderboard either.
  const confirming = await builder({ confirmed: false });
  assert.deepEqual(await highlights(confirming.id, await page(confirming.id), NOW), [{ icon: 'start', title: 'On EarnKit since Apr 4', sub: 'No project on the leaderboard yet' }]);
});

test('(c3) Highlights: won only (never "Applied to"), at most 2, won first; experience fills a free slot only; at most 5', db, async () => {
  const b = await baseBuilder();
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'alliance-all19', 'applied', '2026-10-14T09:00:00Z')`;
  await githubSince(b, '2017-08-20T00:00:00Z');
  const login = (await sql()<{ login: string }[]>`SELECT github_login AS login FROM builder_profiles WHERE builder_id = ${b.id}`)[0].login;
  // Only an application and the GitHub account: the application never shows, experience fills the slot.
  assert.deepEqual(await highlights(b.id, await page(b.id), NOW), [
    { icon: 'experience', title: 'Writing code since 2017', sub: 'On GitHub since Aug 2017', href: `https://github.com/${login}` },
  ]);
  // A win (no guide page: a campaign has none) and an acceptance a public page proved (GTM W2) show; won first.
  const camp = `v31-site-${process.pid}-camp`;
  await won(b, camp, `Campaign ${RUN}`, '2026-09-02T10:00:00Z');
  await sql()`UPDATE programs SET campaign = '{"kind":"earnkit"}'::jsonb WHERE id = ${camp}`;
  const code = Array.from(randomBytes(10), (x) => 'abcdefghijklmnopqrstuvwxyz234567'[x % 32]).join('');
  await sql()`INSERT INTO post_drafts (code, builder_id, project_key, moment, moment_key, shape, text, proof_url, asked, expires_at)
    VALUES (${code}, ${b.id}, ${b.key}, 'accepted', 'accepted:alliance-all19', 'outcome', 'x', 'https://alliance.xyz/ALL19', false, now() + interval '1 day')`;
  let h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h.map((x) => [x.icon, x.title, x.sub, x.href]), [
    ['won', `Won Campaign ${RUN}`, 'Sep 2026', undefined],
    ['won', 'Accepted into Alliance ALL19', 'Oct 2026', '/programs/alliance-all19'],
    ['experience', 'Writing code since 2017', 'On GitHub since Aug 2017', `https://github.com/${login}`],
  ]);
  assert.ok(!JSON.stringify(h).includes('Applied to'));
  // Rows 1 to 5 fill all five slots: experience is left out; the slice keeps the first 5.
  await site(b, 'https://five.example', daysUp('2026-10-21', 8));
  await site(b, 'https://six.example', daysUp('2026-10-21', 2));
  await walletContracts(b, [['base', '2025-01-01T00:00:00Z', true]]);
  h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h.map((x) => x.icon), ['live', 'contract', 'products', 'won', 'won']);
  await sql()`UPDATE builder_projects SET commit_weeks = ${last52(NOW).slice(-3)} WHERE builder_id = ${b.id}`;
  h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h.map((x) => x.icon), ['live', 'contract', 'products', 'consistency', 'won'], 'at most 5: the second program drops');
  // Fix round 1: an unlisted program's guide is a 404 (landing.ts readGuideIds): no link, by the same predicate.
  const gone = `v31-site-${process.pid}-gone`;
  const u = await baseBuilder();
  await won(u, gone, `Gone ${RUN}`, '2026-10-01T09:00:00Z');
  await sql()`UPDATE programs SET status = 'unlisted' WHERE id = ${gone}`;
  const hu = (await highlights(u.id, await page(u.id), NOW)).find((x) => x.icon === 'won');
  assert.deepEqual([hu?.title, hu?.href], [`Won Gone ${RUN}`, undefined]);
  assert.ok(!(await readGuideIds()).includes(gone));
});

/** A day's app_usage row for the builder (used-by.ts writes them daily). */
async function usedBy(b: B, source: 'contracts' | 'builder_code', day: string, users: number, returning: number, o: { href?: string | null; chains?: string[]; capped?: boolean } = {}) {
  await sql()`INSERT INTO app_usage (builder_id, source, day, users, "returning", capped, href, chains)
    VALUES (${b.id}, ${source}, ${day}, ${users}, ${returning}, ${o.capped ?? false}, ${o.href ?? null}, ${o.chains ?? ['base']}::text[])`;
}

test('(c3b) v3.1 Used by: the row comes second (after live), the larger source, the newest day of each, hidden past 3 days; at most 5 rows', db, async () => {
  const b = await baseBuilder({ name: 'Kit' });
  await sql()`UPDATE builder_projects SET commit_weeks = ${last52(NOW).slice(-3)} WHERE builder_id = ${b.id}`;
  await site(b, 'https://kit.example', daysUp('2026-10-21', 8));
  await site(b, 'https://two.example', daysUp('2026-10-21', 2));
  const [c] = await walletContracts(b, [['base', '2025-01-01T00:00:00Z', true]]);
  await won(b, `v31-site-${process.pid}-ub`, `Used ${RUN}`, '2026-09-02T10:00:00Z');
  await githubSince(b, '2017-08-20T00:00:00Z');
  const explorer = `https://basescan.org/address/${c}`;
  // An older day of contracts (bigger, but superseded by the newest) and today's; a Builder Code number that is larger.
  await usedBy(b, 'contracts', '2026-10-19', 900, 10, { href: explorer });
  await usedBy(b, 'contracts', '2026-10-21', 240, 60, { href: explorer });
  const file = `https://github.com/${b.key}/blob/HEAD/src/onchain/tx.ts`;
  await usedBy(b, 'builder_code', '2026-10-20', 300, 0, { href: file });
  let h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h.map((x) => x.icon), ['live', 'users', 'contract', 'products', 'consistency'], 'won and experience drop: at most 5');
  assert.deepEqual(h[1], { icon: 'users', title: 'Used by 300 people in the last 30 days', sub: 'On Base', href: file });
  // The Builder Code number goes stale (over 3 days old): the contracts number shows.
  await sql()`UPDATE app_usage SET day = '2026-10-17' WHERE builder_id = ${b.id} AND source = 'builder_code'`;
  h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h[1], { icon: 'users', title: 'Used by 240 people in the last 30 days', sub: '25% came back', href: explorer });
  // Under USED_MIN: no row. Both stale: no row.
  await usedBy(b, 'contracts', '2026-10-20', 1, 1);
  await sql()`DELETE FROM app_usage WHERE builder_id = ${b.id} AND day = '2026-10-21'`;
  assert.ok(!(await highlights(b.id, await page(b.id), NOW)).some((x) => x.icon === 'users'));
  await sql()`DELETE FROM app_usage WHERE builder_id = ${b.id}`;
  await usedBy(b, 'contracts', '2026-10-17', 500, 0);
  assert.ok(!(await highlights(b.id, await page(b.id), NOW)).some((x) => x.icon === 'users'));
  // A hidden or private repo never links its file.
  const p = await builder({ hidden: true, chains: ['base'], proof: 'github_app', commitWeeks: last52(NOW).slice(-2) });
  await usedBy(p, 'builder_code', '2026-10-21', 50, 0, { href: `https://github.com/${p.key}/blob/HEAD/a.ts` });
  const hp = (await highlights(p.id, await page(p.id), NOW)).find((x) => x.icon === 'users');
  assert.deepEqual(hp, { icon: 'users', title: 'Used by 50 people in the last 30 days', sub: 'On Base' });
});

test('(c4) a private repo: consistency shows without a link (never a 404), the name never shows; its proven site shows; its GitHub-hosted site is never a product', db, async () => {
  const key = `s${RUN}p/stealthy`;
  const b = await builder({ key, name: 'stealthy', hidden: true, chains: ['base'], proof: 'github_app', commitWeeks: last52(NOW).slice(-4) });
  // The App reads the private repo: its reading says private (shownProjects then hides it).
  await sql()`
    INSERT INTO source_live (source_id, signals, ok, read_at)
    SELECT id, ${sql().json({ private: true, created_at: '2025-03-04T10:00:00Z', commits_year: 40, default_branch: 'main' } as never)}, true, now() FROM builder_sources WHERE builder_id = ${b.id} AND kind = 'repo'`;
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at, path) VALUES (${key}, true, ${NOW}, 'src/tx.ts')`;
  await site(b, 'https://stealthy.github.io', daysUp('2026-10-21', 10));
  let h = await highlights(b.id, await page(b.id), NOW);
  assert.ok(!h.some((x) => x.icon === 'live'), 'a hidden repo\'s GitHub-hosted site names the repo: left out');
  // Owner ruling (fix round 1): a site the builder proved shows though the repo is private, even one carrying its name.
  await site(b, 'https://stealthy.app', daysUp('2026-10-21', 10));
  await site(b, 'https://other.example', daysUp('2026-10-21', 3));
  h = await highlights(b.id, await page(b.id), NOW);
  assert.deepEqual(h[0], { icon: 'live', title: 'Live at stealthy.app', sub: 'Up 10 of the last 10 days checked', href: 'https://stealthy.app' });
  assert.deepEqual(h.slice(1), [
    // The GitHub-hosted site of the hidden repo is left out of the products too.
    { icon: 'products', title: 'Shipped 2 products', sub: 'stealthy.app, other.example', href: 'https://stealthy.app' },
    // 2026-10-22: with no name of its own the project reads as its proven site's host.
    { icon: 'consistency', title: 'Shipped in 4 of the last 52 weeks', sub: 'Building stealthy.app since Mar 2025' },
  ]);
  for (const x of h) assert.doesNotMatch(JSON.stringify(x), /stealthy\/|github\.(com|io)/i);
});

test('(c5) owner batch: a private repo\'s consistency line names the proven site host once one is proven, else no name', db, async () => {
  const key = `s${RUN}q/earnkit`;
  const b = await builder({ key, name: 'earnkit', hidden: true, proof: 'github_app', commitWeeks: last52(NOW).slice(-2) });
  const [{ sid }] = await sql()<{ sid: number }[]>`SELECT id::int AS sid FROM builder_sources WHERE builder_id = ${b.id} AND kind = 'repo'`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at)
    VALUES (${sid}, ${sql().json({ private: true, created_at: '2024-12-09T10:00:00Z', commits_year: 1373 } as never)}, true, now())`;
  const line = async () => (await highlights(b.id, await page(b.id), NOW)).find((x) => x.icon === 'consistency');
  assert.deepEqual(await line(), { icon: 'consistency', title: 'Shipped in 2 of the last 52 weeks', sub: 'Building since Dec 2024' }, 'no safe name yet: no name');
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
    VALUES (${b.id}, 'site', ${`https://www.earnkit${RUN}.com`}, ${key}, 'earnkit_txt', 'verified', 'agent', now())`;
  assert.deepEqual((await line())?.sub, `Building earnkit${RUN}.com since Dec 2024`);
});

test('(d) backerWeeks buckets first_block by BASE_GENESIS_UNIX + 2 * block into the last 12 ISO weeks; an older backer counts nowhere; length is 12', db, async () => {
  assert.equal(BASE_GENESIS_UNIX, 1686789347);
  const coin = addr();
  const weeks = last52(NOW).slice(-12);
  const blockAt = (t: number) => Math.ceil((t / 1000 - BASE_GENESIS_UNIX) / 2);
  const monday = (w: string) => Date.parse(`${mondayOfWeek(w)}T00:00:00Z`);
  const rows: [string, number][] = [
    [addr(), blockAt(monday(weeks[0]))], // the first block of the oldest week
    [addr(), blockAt(monday(weeks[0]) + 3 * DAY)],
    [addr(), blockAt(monday(weeks[0])) - 1], // the week before: counts nowhere
    [addr(), blockAt(monday(weeks[5]) + DAY)],
    [addr(), blockAt(NOW.getTime() - 3600_000)],
  ];
  for (const [wallet, block] of rows) await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${wallet}, ${block})`;
  const out = await backerWeeks(coin.toUpperCase().replace('0X', '0x'), NOW);
  assert.equal(out.length, 12);
  assert.deepEqual(out, [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(await backerWeeks(addr(), NOW), Array(12).fill(0));
});

test('(e) standingPill, v3.1 GTM W3: under 10 none; the one rank line of the whole pool with its metal; outside the top 25% none', db, async () => {
  const onBase = async (ids: number[]) => sql()`UPDATE builder_projects SET chains = '{base}' WHERE builder_id IN ${sql()(ids)}`;
  const me = await builder({ chains: ['base'], score: 90, ranked: true });
  const eight = await padPool(8);
  await onBase(eight);
  let only = [me.id, ...eight];
  assert.equal(await standingPill(me.id, await page(me.id, { only }), { only }), null, '9 ranked');
  const ninth = await padPool(1);
  await onBase(ninth);
  only = [...only, ...ninth];
  assert.deepEqual(await standingPill(me.id, await page(me.id, { only }), { only }), { label: '#1 of 10 builders', tier: 'silver', title: '#1 of 10 builders' });
  const more = await padPool(30);
  await onBase(more);
  only = [...only, ...more];
  assert.deepEqual(await standingPill(me.id, await page(me.id, { only }), { only }), { label: 'Top 3% of builders', tier: 'gold', title: 'Top 3% of builders' });
  // The same words the replies, the card and the page meta read (bench-rank.ts rankLines).
  assert.equal((await (await import('./bench-rank')).rankLines(me.id, { only })).bench, 'Top 3% of builders');
  // Rank 11 of 40: 28%, no metal, no pill.
  const top = await padPool(10, 95);
  await onBase(top);
  const mid = [me.id, ...top, ...eight, ...ninth, ...more.slice(0, 20)];
  assert.equal(mid.length, 40);
  assert.equal(await standingPill(me.id, await page(me.id, { only: mid }), { only: mid }), null);
  // An Arc builder: the same whole pool.
  const arc = await builder({ chains: ['arc'], score: 90, ranked: true });
  const pool = [arc.id, ...(await padPool(9))];
  assert.deepEqual(await standingPill(arc.id, await page(arc.id, { only: pool }), { only: pool }), { label: '#1 of 10 builders', tier: 'silver', title: '#1 of 10 builders' });
  // Not ranked: none.
  const unranked = await builder({ chains: ['base'] });
  assert.equal(await standingPill(unranked.id, await page(unranked.id, { only }), { only }), null);
});

/** A launched coin with backing open on the builder's one project (raising.ts raisingCoin's row). */
async function coin(b: B, symbol: string): Promise<string> {
  const c = addr();
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_launched_at, coin_address)
    VALUES ('earnkit-coin', 'Kit', ${`https://github.com/${b.key}`}, ${`github.com/${b.key.toLowerCase()}`}, ${b.id}, ${symbol}, 'launched', ${`https://tokens.fun/coin/${c}`}, now(), now(), ${c})`;
  return c;
}

test('(f) profileSite.token: raising on with an open coin; never with raising off; never for earnkitai/earnkit', db, async () => {
  const b = await builder({ chains: ['base'] });
  const c = await coin(b, 'TIPJAR');
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${c}, ${addr()}, ${Math.ceil((NOW.getTime() / 1000 - BASE_GENESIS_UNIX) / 2) - 100})`;
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    const s = await profileSite(b.id, await page(b.id), NOW);
    assert.ok(s.token);
    assert.equal(s.token.symbol, 'TIPJAR');
    assert.equal(s.token.backers, 1);
    assert.equal(s.token.letter, 'T');
    assert.equal(s.token.weeks.length, 12);
    assert.equal(s.token.weeks[11], 1);
  });
  await withEnv({ EARNKIT_RAISING: undefined }, async () => {
    assert.equal((await profileSite(b.id, await page(b.id), NOW)).token, null);
  });
  // EarnKit's own repo: never backing, even with the flag on and a coin open.
  const own = await builder({ key: 'earnkitai/earnkit', name: 'EarnKit', chains: ['base'], link: 'https://earnkit.com' });
  await coin(own, 'EARNKIT');
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    const s = await profileSite(own.id, await page(own.id), NOW);
    assert.equal(s.token, null);
    assert.equal(s.project?.earnkit, true);
    assert.equal(s.project?.onBase, true);
    assert.deepEqual(s.project?.link, { href: 'https://earnkit.com/', text: 'earnkit.com' });
    assert.equal(s.project?.repo, 'https://github.com/earnkitai/earnkit');
    assert.equal(s.first, 'Sam');
  });
  // Fails closed: an unknown main key (none, or its read failed) never allows the card; EarnKit's repos never do.
  assert.equal(tokenAllowed(null), false);
  assert.equal(tokenAllowed(''), false);
  assert.equal(tokenAllowed('earnkitai/earnkit'), false);
  assert.equal(tokenAllowed('EarnKitAI/other'), false);
  assert.equal(tokenAllowed(b.key), true);
  // Backing on the page data but no main project key (as after a failed read): no Token card.
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    const d = await page(b.id);
    assert.ok(d.backing);
    await sql()`UPDATE builder_profiles SET main_project_key = NULL WHERE builder_id = ${b.id}`;
    try {
      assert.equal((await profileSite(b.id, d, NOW)).token, null);
    } finally {
      await sql()`UPDATE builder_profiles SET main_project_key = ${b.key} WHERE builder_id = ${b.id}`;
    }
  });
});

test('(g) a hidden repo: Private project, no repo, no link unless a non-GitHub site, no about; Highlights never names the repo', db, async () => {
  const key = `s${RUN}h/secretsauce`;
  const b = await builder({ key, name: 'secretsauce', what: 'the secret sauce', link: 'https://own.github.io/secretsauce', hidden: true, commitWeeks: last52(NOW).slice(-2) });
  await site(b, 'https://secretsauce.github.io', [['2026-08-03', true]]);
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'alliance-all19', 'applied', '2026-10-14T09:00:00Z')`;
  const d = await page(b.id);
  const s = await profileSite(b.id, d, NOW);
  assert.equal(s.project?.name, PRIVATE_NAME);
  assert.equal(s.project?.repo, null);
  assert.equal(s.project?.link, null);
  assert.equal(s.project?.about, null);
  assert.equal(s.project?.letter, 'P');
  assert.ok(s.highlights.length > 0);
  for (const h of s.highlights) assert.doesNotMatch(`${h.title} ${h.sub}`, /secretsauce/i, JSON.stringify(h));
  // Its own non-GitHub site is its link.
  await sql()`UPDATE builder_projects SET link = 'https://sauce.example/' WHERE builder_id = ${b.id}`;
  assert.deepEqual((await profileSite(b.id, await page(b.id), NOW)).project?.link, { href: 'https://sauce.example/', text: 'sauce.example' });
});

test('(g3) final review 7: a vibecoder platform subdomain holding the private repo\'s name never names it', () => {
  const hosts = ['lovable.app', 'lovable.dev', 'replit.app', 'replit.dev', 'repl.co', 'bolt.new', 'netlify.app', 'vercel.app', 'framer.website', 'framer.app',
    'webflow.io', 'wixsite.com', 'carrd.co', 'glitch.me', 'pages.dev', 'github.io', 'onrender.com', 'fly.dev', 'railway.app', 'up.railway.app', 'herokuapp.com'];
  for (const h of hosts) {
    assert.equal(siteName(`https://my-app.${h}`, 'my-app'), null, h);
    assert.equal(siteName(`https://www.my-app-prod.${h}/x`, 'my-app'), null, h);
  }
  assert.equal(siteName('https://my-app.com', 'my-app'), 'my-app.com', 'an owned domain may hold it');
});

test('(g2) a hidden repo with a proven site is named by the site host; never GitHub, never one that holds the repo name', db, async () => {
  assert.equal(siteName('https://www.earnkit.com/', 'earnkit'), 'earnkit.com', 'an owned domain may hold the repo name');
  assert.equal(siteName('https://earnkit.vercel.app', 'earnkit'), null, 'a shared platform subdomain holding it would reveal it');
  assert.equal(siteName('https://earnkit.com', 'core'), 'earnkit.com');
  assert.equal(siteName('https://x.github.io/y', 'core'), null);
  assert.equal(siteName('not a url', 'core'), null);
  const key = `s${RUN}k/secretsauce`;
  const b = await builder({ key, name: 'secretsauce', what: 'x', hidden: true, commitWeeks: last52(NOW).slice(-2) });
  await site(b, 'https://secretsauce.github.io', [['2026-08-03', true]]);
  await site(b, 'https://secretsauce.vercel.app', [['2026-08-03', true]]);
  assert.equal((await safeNames([b.id]))(b.id, key), PRIVATE_NAME, 'GitHub host and repo-named host are both skipped');
  await site(b, 'https://www.sauce.example/', [['2026-08-03', true]]);
  assert.equal((await safeNames([b.id]))(b.id, key), 'sauce.example');
  const s = await profileSite(b.id, await page(b.id), NOW);
  assert.equal(s.project?.name, 'sauce.example');
  assert.equal(s.project?.letter, 'S');
  assert.equal(s.project?.repo, null);
});

test('(g3) the builder\'s own name shows when a proven site already makes it public (EarnKit for earnkit.com), even if it is the repo\'s name', db, async () => {
  const key = `s${RUN}g3/earnkit`;
  const b = await builder({ key, name: 'EarnKit', what: 'x', hidden: true, commitWeeks: last52(NOW).slice(-2) });
  // Not told by the builder: the host stands in.
  await site(b, 'https://earnkit.example/', [['2026-08-03', true]]);
  assert.equal((await safeNames([b.id]))(b.id, key), 'earnkit.example');
  // Told by the builder (identity) and the proven site's name matches: their own spelling shows.
  await sql()`UPDATE builder_profiles SET identity = ${sql().json({ projects: [{ name: 'EarnKit', repo: key }] })} WHERE builder_id = ${b.id}`;
  assert.equal((await safeNames([b.id]))(b.id, key), 'EarnKit');
  // A told name that no proven site shows stays private.
  const k2 = `s${RUN}g3b/secretsauce`;
  const c = await builder({ key: k2, name: 'secretsauce', what: 'x', hidden: true, commitWeeks: last52(NOW).slice(-2) });
  await sql()`UPDATE builder_profiles SET identity = ${sql().json({ projects: [{ name: 'secretsauce', repo: k2 }] })} WHERE builder_id = ${c.id}`;
  await site(c, 'https://sauce.example/', [['2026-08-03', true]]);
  assert.equal((await safeNames([c.id]))(c.id, k2), 'sauce.example');
});

test('(h) projectProgramsDated returns the told application\'s at and the entry\'s submitted_at', db, async () => {
  const b = await builder();
  const base = committedProgram('alliance-all19');
  const id = `v31-site-${process.pid}-entry`;
  await upsertProgram(ProgramFile.parse({ ...base, id, title: `Entry program ${RUN}` }));
  await sql()`INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id, submitted_at) VALUES (${id}, 'Kit', ${`https://github.com/${b.key}`}, ${b.key}, ${b.id}, '2026-10-01T10:00:00Z')`;
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'alliance-all19', 'applied', '2026-10-14T09:00:00Z')`;
  const dated = await projectProgramsDated(b.id, b.key);
  assert.deepEqual(dated.map((g) => ({ ...g, at: g.at.toISOString() })), [
    { title: `Entry program ${RUN}`, won: false, applied: true, at: '2026-10-01T10:00:00.000Z', guide: id },
    { title: 'Alliance ALL19', won: false, applied: true, at: '2026-10-14T09:00:00.000Z', guide: 'alliance-all19' },
  ]);
  // projectPrograms keeps its shape (no date).
  assert.deepEqual(await projectPrograms(b.id, b.key), [
    { title: `Entry program ${RUN}`, won: false, applied: true },
    { title: 'Alliance ALL19', won: false, applied: true },
  ]);
});

test('(i) Task 7 fix round 2: the Streak card reads one streak (withThisWeek): bumped, not bumped, already lit, quiet; Highlights never repeats it', db, async () => {
  (globalThis as { React?: typeof React }).React = React;
  const w = last52(NOW);
  const signals = (n: number) => ({ commit_counts: { [isoWeekOf(NOW)]: n }, pushes_checked: true, created_at: '2025-01-01T00:00:00Z' });
  /** The Streak card's "N weeks" and the Highlights lines, from profileSite as the page reads them. */
  const both = async (b: B) => {
    const d = await page(b.id);
    const s = await profileSite(b.id, d, NOW);
    const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, site: s, page: 1 }));
    const card = h.slice(h.indexOf('data-ek-streak'));
    const weeks = Number(/<span class="ek-serif[^"]*">(\d+) weeks?<\/span>/.exec(card)![1]);
    for (const x of s.highlights) assert.doesNotMatch(`${x.title} ${x.sub}`, /in a row/);
    return { weeks, sub: s.highlights.at(-1)!.sub, lit: (card.slice(0, card.indexOf('</div></div>')).match(/bg-s-rust-on/g) ?? []).length, d };
  };
  // Bumped: two weeks before this one, commits this week (not yet in the grid): 3 on the card.
  const bumped = await both(await builder({ commitWeeks: [w[49], w[50]], signals: signals(5) }));
  assert.equal(bumped.d.streak, 3, 'profileData already counts this week');
  assert.deepEqual([bumped.weeks, bumped.lit], [3, 3]);
  // Not bumped: no commits this week.
  const flat = await both(await builder({ commitWeeks: [w[49], w[50]], signals: signals(0) }));
  assert.equal(flat.weeks, 2);
  // Already lit this week: never counted twice.
  const lit = await both(await builder({ commitWeeks: [w[50], w[51]], signals: signals(4) }));
  assert.equal(lit.weeks, lit.d.streak);
  // The first-week builder shipping this week (seeded sam): 2 weeks on the card.
  const fresh = await both(await builder({ commitWeeks: [w[50]], signals: signals(6), claimedAt: new Date(NOW.getTime() - 3 * DAY) }));
  assert.equal(fresh.weeks, 2);
  // Quiet (not confirmed): 0 weeks, nothing lit, and Highlights says it is not on the leaderboard.
  const quiet = await both(await builder({ confirmed: false, source: true, commitWeeks: [w[50]], signals: signals(6) }));
  assert.deepEqual([quiet.weeks, quiet.lit, quiet.sub], [0, 0, 'No project on the leaderboard yet']);
  // The pure rule: commit weeks, shown update weeks and this week's live commits make one set; the streak counts back from it.
  const wk = last52(NOW);
  const rule = (commitWeeks: string[], thisWeekCommits: number) => streakWeeks({ commitWeeks, updates: [], thisWeekCommits }, NOW).streak;
  assert.equal(rule([wk[50]], 3), 2);
  assert.equal(rule([wk[50]], 0), 1);
  assert.equal(rule([wk[50], wk[51]], 9), 2, 'never counted twice');
  assert.equal(rule([wk[48]], 0), 0, 'a gap breaks it');
});

test('(j) clarity batch: profileData\'s avatar is the X picture, else the GitHub one of the proven login, else null', db, async () => {
  const b = await builder();
  const login = `gh${RUN}${n}`;
  await sql()`UPDATE builder_profiles SET x_avatar_url = NULL, github_login = ${login} WHERE builder_id = ${b.id}`;
  assert.equal((await profileData(b.id, NOW))!.avatar, `https://avatars.githubusercontent.com/${login}?s=200`);
  await sql()`UPDATE builder_profiles SET x_avatar_url = 'https://pbs.twimg.com/profile_images/9/me_normal.jpg' WHERE builder_id = ${b.id}`;
  assert.equal((await profileData(b.id, NOW))!.avatar, 'https://pbs.twimg.com/profile_images/9/me_400x400.jpg');
  await sql()`UPDATE builder_profiles SET x_avatar_url = NULL, github_login = NULL WHERE builder_id = ${b.id}`;
  assert.equal((await profileData(b.id, NOW))!.avatar, null);
});

test('(l) v3.1 streak fix: one streak on every surface, whatever builder_projects.streak says (stale 6; real run: 3 commit weeks + this week = 4)', db, async () => {
  (globalThis as { React?: typeof React }).React = React;
  const w = last52(NOW);
  const signals = { commit_counts: { [isoWeekOf(NOW)]: 5 }, pushes_checked: true, created_at: '2025-01-01T00:00:00Z' };
  // The jenilt case: a stored cache of 6 that no commit weeks back (it was written at an earlier rescore), 3 real weeks ending last week, commits this week on the live reading.
  const b = await builder({ commitWeeks: [w[48], w[49], w[50]], signals, ranked: true, score: 70 });
  await sql()`UPDATE builder_projects SET streak = 6, weeks_shipping = 6 WHERE builder_id = ${b.id}`;
  const WANT = 4;
  const d = await page(b.id, { only: [b.id] });
  const site = await profileSite(b.id, d, NOW, { only: [b.id] });
  const view = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, site, page: 1 }));
  const card = view.slice(view.indexOf('data-ek-streak'));
  const got = {
    leaderboard: (await benchRows({ chain: null, weekly: false }, { only: [b.id], now: NOW })).rows[0]?.streak,
    weeklyFilterKeepsIt: (await benchRows({ chain: null, weekly: true }, { only: [b.id], now: NOW })).rows.length,
    profile: d.streak,
    gridSquares: d.grid.filter((g) => g.on).length,
    streakCard: Number(/<span class="ek-serif[^"]*">(\d+) weeks?<\/span>/.exec(card)![1]),
    json: (await builderJson(`s${RUN}${n}`, NOW))?.streak,
    badge: (await benchCardFacts(b.id, { money: false, now: NOW }))?.streak,
    shipLog: (await shipLogFacts(b.id, NOW))?.streak,
  };
  assert.deepEqual(got, {
    leaderboard: WANT, weeklyFilterKeepsIt: 1, profile: WANT, gridSquares: WANT, streakCard: WANT, json: WANT, badge: WANT, shipLog: WANT,
  });
  // The reply and weekly-moment weeks come from the same read.
  assert.equal(await streakOfBuilder(b.id, NOW), WANT);
  // A stale cache can also be too low: nothing stored, but the weeks are there.
  await sql()`UPDATE builder_projects SET streak = 0 WHERE builder_id = ${b.id}`;
  assert.equal((await benchRows({ chain: null, weekly: false }, { only: [b.id], now: NOW })).rows[0]?.streak, WANT);
  // After a missed week the run is over everywhere, though the cache still says 6 until the next rescore.
  const later = new Date(NOW.getTime() + 14 * 7 * DAY);
  assert.equal(await streakOfBuilder(b.id, later), 0);
  assert.equal((await benchRows({ chain: null, weekly: false }, { only: [b.id], now: later })).rows[0]?.streak, 0);
});

test('(m) streak fix review: the cap applies after the weekly filter; a mixed batch; the floor blocks this week; only the main project\'s updates count', db, async () => {
  const w = last52(NOW);
  const thisWeek = (n: number, created = '2025-01-01T00:00:00Z') => ({ commit_counts: { [isoWeekOf(NOW)]: n }, pushes_checked: true, created_at: created });
  // Three ranked builders: the two top scores have no run, the third has WEEKLY_STREAK weeks. The weekly view with a
  // limit of 1 still finds the third (filter first, then the cap).
  const hi1 = await builder({ ranked: true, score: 95, commitWeeks: [], signals: thisWeek(0) });
  const hi2 = await builder({ ranked: true, score: 90, commitWeeks: [], signals: thisWeek(0) });
  const run = await builder({ ranked: true, score: 60, commitWeeks: w.slice(-WEEKLY_STREAK - 1, -1), signals: thisWeek(0) });
  const only = [hi1.id, hi2.id, run.id];
  assert.equal((await benchRows({ chain: null, weekly: false }, { only, now: NOW, limit: 1 })).rows.length, 1);
  const weekly = await benchRows({ chain: null, weekly: true }, { only, now: NOW, limit: 1 });
  assert.deepEqual(weekly.rows.map((r) => r.streak), [WEEKLY_STREAK]);
  // A mixed batch: a builder whose project is not confirmed and one with no project are absent; the confirmed one is read.
  const unconfirmed = await builder({ confirmed: false, commitWeeks: [w[50]] });
  const bare = await person({ projects: [], claimed: `s${RUN}mx` });
  const m = await streaksFor([run.id, unconfirmed.id, bare], NOW);
  assert.deepEqual([...m.keys()], [run.id]);
  assert.equal(m.get(run.id)?.streak, WEEKLY_STREAK);
  // The anti-backdating floor (test (b)): commits counted this week on a repo created after the week do not light it.
  const backdated = await builder({ commitWeeks: [w[50]], signals: thisWeek(5, new Date(NOW.getTime() + 10 * DAY).toISOString()) });
  assert.equal((await streaksFor([backdated.id], NOW)).get(backdated.id)?.streak, 1);
  const counted = await builder({ commitWeeks: [w[50]], signals: thisWeek(5) });
  assert.equal((await streaksFor([counted.id], NOW)).get(counted.id)?.streak, 2);
  // Only the main project's shown updates count: another project's shipped_code week lights nothing.
  const other = await builder({ commitWeeks: [w[50]], signals: thisWeek(0) });
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${other.id}, 'someone/else', ${mondayOfWeek(w[49])}, ${sql().json({ shipped_code: { n: 4 } } as never)})`;
  assert.equal((await streaksFor([other.id], NOW)).get(other.id)?.streak, 1);
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${other.id}, ${other.key}, ${mondayOfWeek(w[49])}, ${sql().json({ shipped_code: { n: 4 } } as never)})`;
  assert.equal((await streaksFor([other.id], NOW)).get(other.id)?.streak, 2, 'the same week on the main project counts');
});
