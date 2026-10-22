import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { profileCode, profileCodesIn } from './discovery-clues';
import { withEnv } from './fixtures/find';
import { readSources } from './sources';
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

/** Every read throws but the site's: `probe` answers `status`, `fetchText` serves `files` (else 404). */
function reader(status: number, files: Record<string, string>, fetched: string[] = []): ReaderDeps {
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  return {
    gh: no, ghGraphql: no, json: no, contractOrigin: no, walletCreations: no, now: NOW,
    probe: async () => ({ status }),
    fetchText: async (url) => {
      fetched.push(url);
      if (url in files) return files[url];
      throw new Error('HTTP 404');
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

/** A repo source already read today (not due), whose earlier reading has `homepage`. */
async function readRepo(proof: string, homepage: string | null, builder = ID) {
  const id = await source({ builder, kind: 'repo', ref: `own${builder}/app`, state: 'verified', proof, by: 'server' });
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
  assert.deepEqual(fetched, [`${SITE}/earnkit.txt`]);
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

test('SP4 a stale or rejected site is never verified by earnkit.txt (the stale rule holds)', dbTest, async () => {
  const stale = await source({ state: 'proposed', proof: null, reject: 'stale' });
  await run(reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }));
  assert.deepEqual(await stateOf(stale), { state: 'proposed', proof: null });
});

test('SP5 a verified site keeps its proof and is not asked for earnkit.txt (repo_link is confirmed in the live score)', dbTest, async () => {
  const linked = await source({ state: 'verified', proof: 'repo_link', by: 'server' });
  const proven = await source({ ref: `https://proven${ID}.example.com`, state: 'verified', proof: 'earnkit_txt', by: 'server' });
  const fetched: string[] = [];
  await run(reader(200, { [`${SITE}/earnkit.txt`]: txt(ID) }, fetched));
  assert.deepEqual(fetched, []);
  assert.deepEqual(await stateOf(linked), { state: 'verified', proof: 'repo_link' });
  assert.deepEqual(await stateOf(proven), { state: 'verified', proof: 'earnkit_txt' });
  assert.equal((await readings(linked)).length, 1);
});

test('SP6 a proposed site that is the homepage of the person\'s App-proven repo is verified repo_link (no GitHub call)', dbTest, async () => {
  await readRepo('github_app', `site${ID}.example.com`);
  const id = await source({ state: 'proposed', proof: null });
  await run(reader(200, {}));
  assert.deepEqual(await stateOf(id), { state: 'verified', proof: 'repo_link' });
});

test('SP7 a homepage of a repo not proven by the App, or another person\'s App-proven repo, proves nothing', dbTest, async () => {
  await readRepo('repo_owner', SITE);
  await readRepo('github_app', SITE, OTHER);
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
