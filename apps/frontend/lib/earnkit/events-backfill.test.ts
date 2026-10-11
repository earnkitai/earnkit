import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { backfillEvents } from './events-backfill';
import { eventsOfInstallation, withEventLog } from './fixtures/events';

// v2.11 Task 3 (3.2, 3.7): the owner-run backfill of builder events from before the log was on.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const W = '0x' + 'Ab'.repeat(20);

/** One row in each source table (and a few that write nothing), for one fresh installation and login (never a shared one: host limits count by login). */
async function seed() {
  const tag = `bf${process.pid}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
  const repoKey = `${tag}/tipjar`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, ${tag}, ${inst}, now(), 3, 'entry')`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'allowed')`;
  const [deploy] = await sql()<{ id: number }[]>`
    INSERT INTO contract_deploys (installation_id, login, builder_key, repo_key, chain, tx_hash, address, status, owner_ok, cost_micro_usd, created_at, owner_wallet, block)
    VALUES (${inst}, ${tag}, ${tag}, ${repoKey}, 'arc', ${'0x' + 'ab'.repeat(32)}, ${'0x' + '12'.repeat(20)}, 'deployed', true, 5000, '2026-10-01T10:00:00Z',
      ${W.toLowerCase()}, 777)
    RETURNING id`;
  // 3.2: sent, left unknown, then settled by the runbook; a reverted one never counts.
  const [settled] = await sql()<{ id: number }[]>`
    INSERT INTO contract_deploys (installation_id, login, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, created_at)
    VALUES (${inst}, ${tag}, ${tag}, ${repoKey}, 'base', ${'0x' + 'cd'.repeat(32)}, 'unknown', 5000, '2026-10-02T10:00:00Z') RETURNING id`;
  await sql()`
    INSERT INTO contract_deploys (installation_id, login, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd)
    VALUES (${inst}, ${tag}, ${tag}, ${repoKey}, 'arc', '0x03', 'reverted', 5000)`;
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
    VALUES (${tag}, ${tag}, ${repoKey}, ${inst}, 10, 1, 'live')`;
  const [host] = await sql()<{ id: number }[]>`
    INSERT INTO host_deploys (login, slug, repo_key, at, status, done_at)
    VALUES (${tag}, ${tag}, ${repoKey}, '2026-10-03T10:00:00Z', 'live', '2026-10-03T10:01:00Z') RETURNING id`;
  await sql()`INSERT INTO host_deploys (login, slug, repo_key, status) VALUES (${tag}, ${tag}, ${repoKey}, 'failed')`;
  const [project] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id, repo_url, creator_wallet, submitted_at)
    VALUES (${tag}, 'Tip Jar', ${inst}, ${`https://github.com/${repoKey}`}, ${W.toLowerCase()}, '2026-10-04T10:00:00Z') RETURNING id`;
  await sql()`
    INSERT INTO submissions (project_id, submission_data, external_submission_url, created_at)
    VALUES (${project.id}, '{}'::jsonb, 'https://dorahacks.io/buidl/77?edit2=secret#top', '2026-10-05T10:00:00Z')`;
  await sql()`
    INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, source_url, captured_at, basis)
    VALUES (${project.id}, ${tag}, 'R1', 'won', 250, 'https://x.example/results', '2026-10-20T00:00:00Z', 'announcement'),
      (${project.id}, ${tag}, 'R0', 'unknown', NULL, 'https://x.example/results', '2026-10-06T00:00:00Z', 'announcement')`;
  return { tag, inst, repoKey, deploy: deploy.id, settled: settled.id, host: host.id, project: project.id };
}

/**
 * Review I3: the seed's committed announcement and live site would move other files' global stats
 * and host limits; they go once the test is done (its events stay: append-only, keyed per test).
 */
async function unseed(s: { tag: string; inst: number }) {
  await sql()`DELETE FROM entry_outcomes WHERE program_id = ${s.tag}`;
  await sql()`UPDATE hosted_sites SET status = 'ended' WHERE slug = ${s.tag}`;
  await sql()`UPDATE programs SET status = 'closed' WHERE id = ${s.tag}`;
}

test('3.7 the backfill writes one event per source row with its own time and the live dedupe keys; a rerun writes 0', dbTest, () =>
  withEventLog(async () => {
    const s = await seed();
    try {
      const first = await backfillEvents(sql(), { installationIds: [s.inst] });
      assert.deepEqual(
        Object.fromEntries(Object.entries(first).map(([k, v]) => [k, v.written])),
        { built: 0, deployed: 1, hosted: 1, entered: 1, submitted: 1, outcomes: 1 },
      );
      const events = await eventsOfInstallation(s.inst);
      const by = new Map(events.map((e) => [e.dedupe_key, e]));
      assert.equal(events.length, 5);

      const d = by.get(`deployed:${s.deploy}`)!;
      assert.equal(d.type, 'deployed');
      assert.equal(d.at.toISOString(), '2026-10-01T10:00:00.000Z');
      assert.equal(d.proof_tx, '0x' + 'ab'.repeat(32));
      assert.equal(d.chain, 'arc');
      assert.equal(d.wallet, W.toLowerCase(), 'the owner wallet the row kept');
      assert.deepEqual([d.github_login, d.login_basis], [s.tag, 'signin']);
      assert.deepEqual(d.detail, { address: '0x' + '12'.repeat(20), owner_ok: true, block: 777, backfill: true });

      const h = by.get(`hosted:${s.host}`)!;
      assert.equal(h.at.toISOString(), '2026-10-03T10:01:00.000Z');
      assert.equal(h.proof_url, `https://${s.tag}.earnkit.com`);
      assert.equal(h.installation_id, s.inst);
      assert.deepEqual(h.detail, { host: 'earnkit', slug: s.tag, backfill: true });

      const e = by.get(`entered:${s.project}`)!;
      assert.equal(e.at.toISOString(), '2026-10-04T10:00:00.000Z');
      assert.equal(e.wallet, null, 'creator_wallet may be set later (a token launch): never put on the entry event (review M4)');
      assert.equal(e.repo_key, s.repoKey);
      assert.match(e.proof_url ?? '', new RegExp(`/p/${s.project}$`));

      const sub = by.get(`submitted:${s.project}`)!;
      assert.equal(sub.at.toISOString(), '2026-10-05T10:00:00.000Z');
      assert.equal(sub.proof_url, 'https://dorahacks.io/buidl/77', 'no query or fragment (review M7)');

      const won = by.get(`outcome:${s.project}:R1:announcement`)!;
      assert.equal(won.type, 'won');
      assert.equal(won.at.toISOString(), '2026-10-20T00:00:00.000Z');
      assert.deepEqual(won.detail, { basis: 'announcement', result: 'won', round: 'R1', prize_usd: 250, backfill: true });

      const again = await backfillEvents(sql(), { installationIds: [s.inst] });
      assert.deepEqual(
        Object.fromEntries(Object.entries(again).map(([k, v]) => [k, v.written])),
        { built: 0, deployed: 0, hosted: 0, entered: 0, submitted: 0, outcomes: 0 },
      );
      assert.equal(again.deployed.seen, 1);
      assert.equal((await eventsOfInstallation(s.inst)).length, 5);
    } finally {
      await unseed(s);
    }
  }),
);

test('3.2 a deploy the runbook settled from unknown to deployed is picked up by the next backfill', dbTest, () =>
  withEventLog(async () => {
    const s = await seed();
    try {
      await backfillEvents(sql(), { installationIds: [s.inst] });
      await sql()`UPDATE contract_deploys SET status = 'deployed', address = ${'0x' + '34'.repeat(20)} WHERE id = ${s.settled}`;
      const next = await backfillEvents(sql(), { installationIds: [s.inst] });
      assert.equal(next.deployed.written, 1);
      const [e] = (await eventsOfInstallation(s.inst)).filter((x) => x.dedupe_key === `deployed:${s.settled}`);
      assert.equal(e.chain, 'base');
      assert.equal(e.at.toISOString(), '2026-10-02T10:00:00.000Z');
      assert.equal(e.wallet, null, 'an older row kept no owner wallet: none is made up');
      assert.deepEqual(e.detail, { address: '0x' + '34'.repeat(20), owner_ok: null, backfill: true }, 'no block: T11 reads it from the receipt');
    } finally {
      await unseed(s);
    }
  }),
);

test('final fix I1, M1: the backfill writes the build path\'s built and Pages hosted events with their own times, and a proof-line upload as proof_line', dbTest, () =>
  withEventLog(async () => {
    const s = await seed();
    try {
      const repoUrl = `https://github.com/${s.repoKey}`;
      await sql()`
        UPDATE installations SET build = ${sql().json({
          program_id: s.tag, starter_id: 'arc-tipjar', started_at: '2026-09-30T09:00:00Z', wallet: W.toLowerCase(),
          twist: 'tips for podcasters', name: 'PodTips', description: 'd', feature: 'f', for_whom: 'podcasters', repo_url: repoUrl,
        } as never)} WHERE id = ${s.inst}`;
      const [owner] = s.repoKey.split('/');
      const live = `https://${owner}.github.io/tipjar/`;
      await sql()`UPDATE projects SET live_url = ${live} WHERE id = ${s.project}`;
      // A second entry whose link is another repo's Pages page: never hosted for this repo.
      await sql()`
        INSERT INTO projects (program_id, name, installation_id, repo_url, live_url, submitted_at)
        VALUES (${s.tag}, 'Other', ${s.inst}, ${repoUrl}, ${`https://${owner}.github.io/other/`}, '2026-10-04T11:00:00Z')`;
      const [proofHost] = await sql()<{ id: number }[]>`
        INSERT INTO host_deploys (login, slug, repo_key, at, status, done_at, basis)
        VALUES (${s.tag}, ${s.tag}, ${s.repoKey}, '2026-10-03T11:00:00Z', 'live', '2026-10-03T11:01:00Z', 'proof_line') RETURNING id`;

      const first = await backfillEvents(sql(), { installationIds: [s.inst] });
      assert.equal(first.built.written, 1);
      assert.equal(first.hosted.written, 3, 'the signed-in upload, the proof-line upload and the Pages link');
      const by = new Map((await eventsOfInstallation(s.inst)).map((e) => [e.dedupe_key, e]));

      const b = by.get(`built:${s.inst}:${s.repoKey}:${s.tag}`)!;
      assert.equal(b.type, 'built');
      assert.equal(b.at.toISOString(), '2026-10-01T10:00:00.000Z', 'the first contract_deploys row of the build repo');
      assert.equal(b.wallet, W.toLowerCase());
      assert.equal(b.program_id, s.tag);
      assert.equal(b.proof_url, repoUrl);
      assert.deepEqual([b.github_login, b.login_basis], [s.tag, 'signin']);
      assert.deepEqual(b.detail, { starter: 'arc-tipjar', twist: 'tips for podcasters', backfill: true });

      const gh = by.get(`hosted:gh:${s.inst}:${s.repoKey}:${live}`)!;
      assert.equal(gh.type, 'hosted');
      assert.equal(gh.at.toISOString(), '2026-10-04T10:00:00.000Z');
      assert.equal(gh.proof_url, live);
      assert.deepEqual([gh.github_login, gh.login_basis], [s.tag, 'signin']);
      assert.deepEqual(gh.detail, { host: 'github_pages', probe: false, backfill: true });
      assert.ok(![...by.keys()].some((k) => k.includes('/other/')), 'another repo\'s Pages link is never hosted');

      const ph = by.get(`hosted:${proofHost.id}`)!;
      assert.equal(ph.login_basis, 'proof_line', 'M1: never overstated as a sign-in');
      assert.equal(by.get(`hosted:${s.host}`)!.login_basis, 'signin');

      const again = await backfillEvents(sql(), { installationIds: [s.inst] });
      assert.deepEqual([again.built.written, again.hosted.written], [0, 0]);
    } finally {
      await unseed(s);
    }
  }),
);

test('final fix I1: no built or Pages hosted event without a contract EarnKit deployed for that build repo', dbTest, () =>
  withEventLog(async () => {
    const s = await seed();
    try {
      await sql()`DELETE FROM contract_deploys WHERE installation_id = ${s.inst}`;
      const [owner] = s.repoKey.split('/');
      await sql()`
        UPDATE installations SET build = ${sql().json({ program_id: s.tag, starter_id: 'arc-tipjar', started_at: '2026-09-30T09:00:00Z', repo_url: `https://github.com/${s.repoKey}` } as never)}
        WHERE id = ${s.inst}`;
      await sql()`UPDATE projects SET live_url = ${`https://${owner}.github.io/tipjar/`} WHERE id = ${s.project}`;
      const counts = await backfillEvents(sql(), { installationIds: [s.inst] });
      assert.equal(counts.built.seen, 0);
      assert.equal(counts.hosted.written, 1, 'only the EarnKit upload');
    } finally {
      await unseed(s);
    }
  }),
);

test('the backfill writes nothing while EARNKIT_EVENT_LOG is off'
, dbTest, async () => {
  const s = await seed();
  try {
    const counts = await backfillEvents(sql(), { installationIds: [s.inst] });
    assert.ok(Object.values(counts).every((c) => c.seen === 0 && c.written === 0));
    assert.equal((await eventsOfInstallation(s.inst)).length, 0);
  } finally {
    await unseed(s);
  }
});

test('the backfill is owner-run only: never in predeploy, the cron or any app code path', () => {
  const root = join(import.meta.dirname, '..', '..', '..', '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  for (const [name, cmd] of Object.entries(pkg.scripts)) assert.ok(!/events-backfill/.test(cmd), `package.json ${name}`);
  const front = join(root, 'apps', 'frontend');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
    }
  };
  walk(join(front, 'lib'));
  walk(join(front, 'app'));
  const users = files.filter((f) => /events-backfill/.test(readFileSync(f, 'utf8')) && !f.endsWith('events-backfill.ts'));
  assert.deepEqual(users, [], 'only scripts/events-backfill.mts runs it');
});
