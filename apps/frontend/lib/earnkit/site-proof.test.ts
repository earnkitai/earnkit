import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { profileCode, profileCodesIn } from './discovery-clues';
import { withEnv } from './fixtures/find';
import { ScoreDeadline } from './campaigns';
import { SITE_PROOF_EXEMPT_MAX, SITE_PROOF_LOST, SITE_PROOF_MISSES_MAX, readSources } from './sources';
import { RedirectError, SafeFetchError } from './safe-fetch';
import type { ReaderDeps } from './source-readers';

/**
 * v3.1 site proof: a proposed site is verified on its existing daily read, by its origin's earnkit.txt naming the
 * person (`profile:` code, earnkit_txt) or by being the homepage of the person's App-proven repo (repo_link).
 */
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// source_readings is append-only: every test takes fresh builder ids instead of deleting.
const BASE = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
let n = 0;
let ID = BASE;
let OTHER = BASE + 1;
let SITE = '';
const SECRET = 's'.repeat(40);
const NOW = new Date('2026-10-23T10:00:00Z');
const DAY = '2026-10-23';

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
beforeEach(() => {
  n += 2;
  ID = BASE + n;
  OTHER = ID + 1;
  SITE = `https://site${ID}.example.com`;
});

/** A served file: its body, or its body and content type (default text/plain), or a thrown error. */
type Served = string | { body: string; type?: string } | Error;
/**
 * Every read throws but the site's: `probe` answers `status`, `fetchText` serves `files` (else 404) as the real
 * safeFetchText does: with `plainText`, a response that is not text/plain is refused (safe-fetch.test.ts).
 */
function reader(status: number, files: Record<string, Served>, fetched: string[] = []): ReaderDeps {
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  return {
    gh: no, ghGraphql: no, json: no, contractOrigin: no, walletCreations: no, now: NOW,
    probe: async () => ({ status }),
    fetchText: async (url, o) => {
      fetched.push(`${url}${o?.plainText ? ' (plain)' : ''}`);
      const f = files[url];
      if (f === undefined) throw new SafeFetchError('answered 404, not 200');
      if (f instanceof Error) throw f;
      const { body, type = 'text/plain' } = typeof f === 'string' ? { body: f } : f;
      if (o?.plainText && !/^\s*text\/plain\b/i.test(type)) throw new SafeFetchError(`not text/plain (${type})`);
      return body;
    },
  };
}

/** A source of a tracked project (so a proposed agent site is due for its display read). */
async function source(o: { builder?: number; kind?: string; ref?: string; state: string; proof: string | null; by?: string; reject?: string | null; key?: string }) {
  const builder = o.builder ?? ID;
  const key = o.key ?? `own${ID}/app`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, tracked)
    VALUES (${builder}, ${key}, 'app', 'code', true, true, true) ON CONFLICT (builder_id, project_key) DO NOTHING`;
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, reject_reason)
    VALUES (${builder}, ${o.kind ?? 'site'}, ${o.ref ?? SITE}, ${key}, ${o.state}, ${o.proof}, ${o.by ?? 'agent'}, ${o.reject ?? null}) RETURNING id`;
  return Number(row.id);
}

/**
 * A repo source (`ref`, its own project key; default the site's project `own<ID>/app`) already read today (not
 * due), whose latest reading has `homepage`; `older`: an earlier reading's homepage.
 */
async function readRepo(proof: string, homepage: string | null, o: { builder?: number; ref?: string; older?: string } = {}) {
  const ref = o.ref ?? `own${ID}/app`;
  const id = await source({ builder: o.builder, kind: 'repo', ref, key: ref, state: 'verified', proof, by: 'server' });
  if (o.older !== undefined) await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${id}, '2026-10-21', ${sql().json({ homepage: o.older } as never)}, true)`;
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${id}, '2026-10-22', ${sql().json({ homepage } as never)}, true)`;
  await sql()`UPDATE builder_sources SET last_read_day = ${DAY} WHERE id = ${id}`;
  return id;
}

const stateOf = async (id: number) => {
  const [r] = await sql()<{ state: string; proof: string | null }[]>`SELECT state, proof FROM builder_sources WHERE id = ${id}`;
  return r;
};
const readings = async (id: number) => sql()<{ ok: boolean; signals: { up?: boolean } }[]>`SELECT ok, signals FROM source_readings WHERE source_id = ${id}`;
const run = (r: ReaderDeps) => withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => readSources(NOW, { deadline: Date.now() + 10_000, reader: r, only: [ID, OTHER] }));
const txt = (builder: number, origin = SITE) => `# EarnKit\nprofile: ${profileCode(builder, origin, SECRET)}\n`;

test('SP1 a proposed site whose earnkit.txt names the person is verified earnkit_txt on its daily read', dbTest, async () => {
  const id = await source({ state: 'proposed', proof: null });
  const fetched: string[] = [];
  await run(reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }, fetched));
  assert.deepEqual(fetched, [`${SITE}/earnkit.txt (plain)`]);
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'earnkit_txt' });
  const r = await readings(id);
  assert.equal(r.length, 1);
  assert.equal(r[0].ok, true);
  assert.equal(r[0].signals.up, true);
});

test('SP2 no earnkit.txt, another person\'s code, or another origin\'s code: the site stays proposed (still read for display)', dbTest, async () => {
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
  assert.equal((await readings(id)).length, 1);
  await sql()`UPDATE builder_sources SET last_read_day = NULL WHERE id = ${id}`;
  await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => readSources(new Date('2026-10-24T10:00:00Z'), { deadline: Date.now() + 10_000, reader: reader(200, { [`${SITE}/earnkit.txt`]: `${txt(OTHER)}profile: ${profileCode(ID, 'https://elsewhere.example.com', SECRET)}\n` }), only: [ID] }));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
});

test('SP3 a down site is not asked for earnkit.txt; no secret means no code and no verification', dbTest, async () => {
  const id = await source({ state: 'proposed', proof: null });
  const fetched: string[] = [];
  await run(reader(503, { [`${SITE}/earnkit.txt`]: txt(ID) }, fetched));
  assert.deepEqual(fetched, []);
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
  await withEnv({ EARNKIT_AUTH_SECRET: undefined }, () =>
    readSources(new Date('2026-10-24T10:00:00Z'), { deadline: Date.now() + 10_000, reader: reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }), only: [ID] }));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
});

test('SP4 a stale or rejected site is never verified by earnkit.txt or a homepage (the stale rule holds)', dbTest, async () => {
  await readRepo('github_app', SITE);
  const stale = await source({ state: 'proposed', proof: null, reject: 'stale' });
  const rejectedSite = `https://gone${ID}.example.com`;
  const rejected = await source({ ref: rejectedSite, state: 'rejected', proof: null, reject: 'repo_mismatch' });
  const fetched: string[] = [];
  await run(reader(200, { [`${SITE}/earnkit.txt`]: txt(ID), [`${rejectedSite}/earnkit.txt`]: txt(ID, rejectedSite) }, fetched));
  assert.deepEqual(fetched, []);
  assert.deepEqual(await stateOf(stale), { state: 'proposed', proof: null });
  assert.deepEqual(await stateOf(rejected), { state: 'rejected', proof: null });
});

test('SP5 a verified site keeps its proof; only an earnkit_txt one is asked for earnkit.txt again (fix round)', dbTest, async () => {
  const linked = await source({ state: 'verified', proof: 'repo_link', by: 'server' });
  const provenSite = `https://proven${ID}.example.com`;
  const proven = await source({ ref: provenSite, state: 'verified', proof: 'earnkit_txt', by: 'server' });
  const fetched: string[] = [];
  await run(reader(200, { [`${SITE}/earnkit.txt`]: txt(ID), [`${provenSite}/earnkit.txt`]: txt(ID, provenSite) }, fetched));
  assert.deepEqual(fetched, [`${provenSite}/earnkit.txt (plain)`]);
  assert.deepEqual(await stateOf(linked), { state: 'verified', proof: 'repo_link' });
  assert.deepEqual(await stateOf(proven), { state: 'verified', proof: 'earnkit_txt' });
  assert.equal((await readings(linked)).length, 1);
});

const misses = async (id: number) => (await sql()<{ m: number }[]>`SELECT proof_misses AS m FROM builder_sources WHERE id = ${id}`)[0].m;
const runOn = (day: string, r: ReaderDeps) =>
  withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => readSources(new Date(`${day}T10:00:00Z`), { deadline: Date.now() + 10_000, reader: r, only: [ID] }));

test('SP11 fix round, wave (4): a verified earnkit_txt site that answers anything but its code 3 days in a row loses its proof; a day counts once; down is not checked', dbTest, async () => {
  const id = await source({ state: 'verified', proof: 'earnkit_txt', by: 'server' });
  await runOn('2026-10-23', reader(200, {}));
  assert.equal(await misses(id), 1, 'a 404 is a miss');
  // The same day again (a second run): not counted twice.
  await sql()`UPDATE builder_sources SET last_read_day = NULL WHERE id = ${id}`;
  await runOn('2026-10-23', reader(200, {}));
  assert.equal(await misses(id), 1);
  // Down that day (the probe failed): not checked. A transport failure: exempt.
  await runOn('2026-10-24', reader(503, {}));
  await runOn('2026-10-25', reader(200, { [`${SITE}/earnkit.txt`]: new SafeFetchError("couldn't fetch it (read ECONNRESET)") }));
  assert.equal(await misses(id), 1);
  await runOn('2026-10-26', reader(200, { [`${SITE}/earnkit.txt`]: txt(OTHER) }));
  assert.equal(await misses(id), 2, 'another person\'s code is a miss');
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'earnkit_txt' });
  await runOn('2026-10-27', reader(200, { [`${SITE}/earnkit.txt`]: new SafeFetchError('answered 502, not 200') }));
  const [r] = await sql()<{ state: string; proof: string | null; reason: string | null }[]>`SELECT state, proof, reject_reason AS reason FROM builder_sources WHERE id = ${id}`;
  assert.deepEqual(r, { state: 'proposed', proof: null, reason: SITE_PROOF_LOST }, 'a 5xx is a miss too; the third revokes');
  assert.equal(SITE_PROOF_MISSES_MAX, 3);
  // Still read; the code back re-verifies it as earnkit_txt with the count reset.
  const before = (await readings(id)).length;
  await runOn('2026-10-28', reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }));
  assert.equal((await readings(id)).length, before + 1, 'kept being read');
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'earnkit_txt' });
  assert.equal(await misses(id), 0);
});

test('SP14 fix wave (4, security ruling): a redirect, an oversized body and another content type are each a miss', dbTest, async () => {
  const id = await source({ state: 'verified', proof: 'earnkit_txt', by: 'server' });
  await runOn('2026-10-23', reader(200, { [`${SITE}/earnkit.txt`]: new RedirectError(301, 'https://elsewhere.example.com/earnkit.txt') }));
  assert.equal(await misses(id), 1, 'a redirect');
  await runOn('2026-10-24', reader(200, { [`${SITE}/earnkit.txt`]: new SafeFetchError('larger than 4096 bytes') }));
  assert.equal(await misses(id), 2, 'over the size cap');
  await runOn('2026-10-25', reader(200, { [`${SITE}/earnkit.txt`]: { body: txt(ID), type: 'text/html' } }));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null }, 'the code in an HTML page: the wrong type, the third miss');
});

test('SP15 fix wave (4, security ruling): 7 exempt days in a row count as a miss; a success resets the exempt days', dbTest, async () => {
  const id = await source({ state: 'verified', proof: 'earnkit_txt', by: 'server' });
  const exemptDays = async () => (await sql()<{ n: number }[]>`SELECT proof_exempt_days AS n FROM builder_sources WHERE id = ${id}`)[0].n;
  const timeout = reader(200, { [`${SITE}/earnkit.txt`]: new SafeFetchError('no answer within 5 s') });
  for (let d = 1; d <= 6; d++) await runOn(`2026-11-0${d}`, timeout);
  assert.deepEqual([await misses(id), await exemptDays()], [0, 6]);
  await runOn('2026-11-07', reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }));
  assert.deepEqual([await misses(id), await exemptDays()], [0, 0], 'a success resets');
  for (let d = 8; d <= 14; d++) await runOn(`2026-11-${String(d).padStart(2, '0')}`, timeout);
  assert.deepEqual([await misses(id), await exemptDays()], [1, 0], 'the 7th exempt day in a row is a miss');
  assert.equal(SITE_PROOF_EXEMPT_MAX, 7);
});

test('SP12 fix round: one success resets the misses', dbTest, async () => {
  const id = await source({ state: 'verified', proof: 'earnkit_txt', by: 'server' });
  await runOn('2026-10-23', reader(200, {}));
  await runOn('2026-10-24', reader(200, {}));
  assert.equal(await misses(id), 2);
  await runOn('2026-10-25', reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }));
  assert.equal(await misses(id), 0);
  await runOn('2026-10-26', reader(200, {}));
  await runOn('2026-10-27', reader(200, {}));
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'earnkit_txt' }, 'two misses after the reset: still verified');
});

test('SP13 fix round: the run\'s deadline during the check counts nothing', dbTest, async () => {
  const id = await source({ state: 'verified', proof: 'earnkit_txt', by: 'server' });
  for (const day of ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'])
    await runOn(day, reader(200, { [`${SITE}/earnkit.txt`]: new ScoreDeadline() }));
  assert.equal(await misses(id), 0);
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'earnkit_txt' });
});

test('SP6 a proposed site that is the homepage of the person\'s App-proven repo is verified repo_link (no GitHub call)', dbTest, async () => {
  await readRepo('github_app', `site${ID}.example.com`);
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'repo_link' });
});

test('SP7 a homepage of a repo not proven by the App, or another person\'s App-proven repo, proves nothing', dbTest, async () => {
  await readRepo('repo_owner', SITE);
  await readRepo('github_app', SITE, { builder: OTHER });
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
});

test('SP8 the homepage match wins over earnkit.txt (repo_link, the confirmed proof) with no earnkit.txt fetch', dbTest, async () => {
  await readRepo('github_app', SITE);
  const id = await source({ state: 'proposed', proof: null });
  const fetched: string[] = [];
  await run(reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }, fetched));
  assert.deepEqual(fetched, []);
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'repo_link' });
});

test('SP11 a homepage of another project\'s App-proven repo (same person) does not prove this project\'s site', dbTest, async () => {
  await readRepo('github_app', SITE, { ref: `own${ID}/other` });
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
});

test('SP12 a github.io site needs the matched repo\'s owner: another owner\'s Pages host is refused, its own is verified', dbTest, async () => {
  const theirs = `https://alice${ID}.github.io`;
  await readRepo('github_app', theirs);
  const a = await source({ ref: theirs, state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(a), { state: 'proposed', proof: null });
  n += 2;
  ID = BASE + n;
  await readRepo('github_app', `https://own${ID}.github.io`);
  const b = await source({ ref: `https://own${ID}.github.io`, state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(b), { state: 'verified', proof: 'repo_link' });
});

test('SP18 a trailing-dot host never proves: another owner\'s Pages host with a dot cannot dodge the owner check', dbTest, async () => {
  const dotted = `https://alice${ID}.github.io.`;
  await readRepo('github_app', dotted);
  const id = await source({ ref: dotted, state: 'proposed', proof: null });
  const fetched: string[] = [];
  await run(reader(200, {}, fetched));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
  assert.deepEqual(fetched, []);
});

test('SP13 the homepage must be the same origin: www vs apex and look-alike hosts are refused; a path is fine', dbTest, async () => {
  const host = `site${ID}.example.com`;
  for (const home of [`www.${host}`, `https://${host}.evil.com`, `https://evil-${host}`, `https://${host}@evil.com`, `http://${host}:8443`]) {
    n += 2;
    ID = BASE + n;
    SITE = `https://${host}`;
    await readRepo('github_app', home);
    const id = await source({ state: 'proposed', proof: null });
    await run(reader(200, {}));
    assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null }, home);
  }
  n += 2;
  ID = BASE + n;
  await readRepo('github_app', `https://${host}/docs?x=1`);
  const ok = await source({ state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(ok), { state: 'verified', proof: 'repo_link' });
});

test('SP14 only the latest repo reading counts: a homepage since removed proves nothing', dbTest, async () => {
  await readRepo('github_app', null, { older: SITE });
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
});

test('SP15 an earnkit.txt fetch cut by the deadline keeps the site\'s reading and stops the run', dbTest, async () => {
  const id = await source({ state: 'proposed', proof: null });
  const out = await run(reader(200, { [`${SITE}/earnkit.txt`]: new ScoreDeadline() }));
  assert.equal(out.read, 1);
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
  const r = await readings(id);
  assert.equal(r.length, 1);
  assert.equal(r[0].ok, true);
});

test('SP16 a failing proof step never fails the reading: an earnkit.txt read error keeps it ok', dbTest, async () => {
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, { [`${SITE}/earnkit.txt`]: new Error('ECONNRESET') }));
  const r = await readings(id);
  assert.equal(r.length, 1);
  assert.equal(r[0].ok, true);
});

test('SP17 earnkit.txt served as HTML (or any type but text/plain) proves nothing', dbTest, async () => {
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, { [`${SITE}/earnkit.txt`]: { body: txt(ID), type: 'text/html; charset=utf-8' } }));
  assert.deepEqual(await stateOf(id), { state: 'proposed', proof: null });
  assert.equal((await readings(id)).length, 1);
});

const FRONTEND = join(import.meta.dirname, '..', '..');

test('SP9 the owner\'s proof file is public/earnkit.txt (served at /earnkit.txt) with exactly the profile line', () => {
  const body = readFileSync(join(FRONTEND, 'public', 'earnkit.txt'), 'utf8');
  assert.equal(body, 'profile: ae6e24ff180d7ee8\n');
  assert.deepEqual(profileCodesIn(body), ['ae6e24ff180d7ee8']);
});

test('SP10 nothing shadows /earnkit.txt: no middleware or proxy, no rewrites, no app route of that name', () => {
  for (const f of ['middleware.ts', 'middleware.js', 'proxy.ts', 'proxy.js', 'app/earnkit.txt', 'app/earnkit.txt/route.ts'])
    assert.throws(() => readFileSync(join(FRONTEND, f)), `${f} must not exist`);
  assert.doesNotMatch(readFileSync(join(FRONTEND, 'next.config.ts'), 'utf8'), /rewrites|earnkit\.txt/);
});
