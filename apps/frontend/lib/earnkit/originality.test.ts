import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { appSetup } from './github-app';
import { createVerifyLink, csrfCookieName } from './github-verify';
import { connectInstallation, saveInstallation } from './installations';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub, type FakeGitHub, type FakeRepo } from './fixtures/fake-github';
import { appEnv } from './fixtures/app-install';
import { attachToX } from './x-install';
import { profileData } from './bench-data';
import { DATA } from './fixtures/profile-data';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { padPool } from './fixtures/rank-pool';
import {
  DIMS, README_CHARS, README_MAX_BYTES, cosine, workerEmbed, workerScript, nearestOf, originalityOf, originalityStep, originalityText, readOriginality, readReadme, boundedEmbed, EmbedDeadline, stripMarkdown, textHash,
  type Embed,
} from './originality';

/** Scoring and clarity R3: Originality, a separate 0 to 100 value per main project, shown beside Shipping, never ranked. */

(globalThis as { React?: typeof React }).React = React;
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const NOW = new Date();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const far = () => Date.now() + 60_000;

/**
 * A fake embedder: each word (lowercase letters, 4 or more) adds 1 to one of DIMS buckets by its hash. Texts with the
 * same words point the same way; texts with no shared word are close to orthogonal. Counts its calls.
 */
function fakeEmbed(): Embed & { calls: string[][] } {
  const calls: string[][] = [];
  const f = (async (texts: string[]) => {
    calls.push(texts);
    return texts.map((t) => {
      const v = new Array<number>(DIMS).fill(0);
      for (const w of t.toLowerCase().match(/[a-z]{4,}/g) ?? []) v[parseInt(sha(w).slice(0, 8), 16) % DIMS] += 1;
      return v;
    });
  }) as Embed & { calls: string[][] };
  f.calls = calls;
  return f;
}

// ---- pure ----

test('O1 the formula: similarity 0.35 or less is 100, 0.9 or more is 0, linear between', () => {
  assert.equal(originalityOf(0.35), 100);
  assert.equal(originalityOf(0.1), 100);
  assert.equal(originalityOf(-0.4), 100);
  assert.equal(originalityOf(0.9), 0);
  assert.equal(originalityOf(1), 0);
  assert.equal(originalityOf(0.625), 50);
  // round(100 x (0.9 - 0.5) / 0.55) = round(72.7) = 73
  assert.equal(originalityOf(0.5), 73);
  assert.equal(originalityOf(Number.NaN), 100);
});

test('O2 cosine, the stripped README and the text: the description first, the README cut at README_CHARS', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 2]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
  const md = [
    '# Fridge Planner', '[![build](https://img.shields.io/x.svg)](https://ci.example)', '![logo](logo.png)',
    'Plans **meals** from a [photo](https://x.example/a) of your `fridge`.', '```js', 'const secret = 1;', '```', '<p align="center">hi</p>', '- one', '| a | b |',
  ].join('\n');
  const words = stripMarkdown(md);
  assert.equal(words, 'Fridge Planner Plans meals from a photo of your fridge. hi one a b');
  const long = 'word '.repeat(2000);
  const t = originalityText('A recipe planner.', long);
  assert.ok(t.startsWith('A recipe planner.\n'));
  assert.equal(t.length, 'A recipe planner.\n'.length + README_CHARS - 1, 'trimmed at the cut');
  assert.equal(originalityText('', null), '');
  assert.notEqual(textHash('a'), textHash('b'));
});

test('O2b a huge pathological README is capped before any pattern runs and strips fast; at most README_MAX_BYTES are decoded', async () => {
  const nasty = [
    '[!['.repeat(40_000), '`'.repeat(30_000), '!['.repeat(20_000), '[x]('.repeat(10_000), ' \t'.repeat(20_000) + '-',
    '<'.repeat(20_000), '```' + 'a'.repeat(10_000), '# '.repeat(10_000), '-*'.repeat(10_000) + ' x',
  ].join('\n');
  assert.ok(nasty.length >= 200_000, String(nasty.length));
  const t0 = performance.now();
  const out = originalityText('d', nasty);
  stripMarkdown(nasty.split('').reverse().join(''));
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `${ms} ms`);
  assert.ok(out.length <= 2 + README_CHARS);
  // The fetch side: a 1 MB README decodes to README_MAX_BYTES at most.
  const big = 'x'.repeat(1_000_000);
  const content = Buffer.from(big).toString('base64').replace(/(.{60})/g, '$1\n');
  const got = await readReadme(async <T,>() => ({ content, encoding: 'base64' }) as T, 'a/b');
  assert.equal(got!.length, README_MAX_BYTES);
  assert.equal(await readReadme(async () => null, 'a/b'), null, 'a failed read');
  assert.equal(await readReadme(async (_p, o) => o!.on404 ?? null, 'a/b'), '', 'no README (404)');
});

test('O3 the nearest list leaves out the builder\'s own projects and itself; ideas count', () => {
  const others = [
    { kind: 'project' as const, key: 'me/other', builder_id: 1, vec: [1, 0] },
    { kind: 'project' as const, key: 'you/close', builder_id: 2, vec: [0.9, 0.1] },
    { kind: 'idea' as const, title: 'todo list app', vec: [0, 1] },
  ];
  const r = nearestOf([1, 0], { key: 'me/main', builder_id: 1 }, others);
  assert.deepEqual(r.nearest.map((n) => (n.kind === 'project' ? n.key : n.title)), ['you/close', 'todo list app']);
  assert.equal(r.max, r.nearest[0].similarity);
  assert.equal(nearestOf([1, 0], { key: 'x', builder_id: 9 }, []).max, 0);
});

test('O4 the model worker never runs in a test unless opted in', { skip: process.env.EARNKIT_MODEL_TEST === '1' && 'model test on' }, async () => {
  await assert.rejects(workerEmbed({ deadline: far() })(['x']), /embedding is off/);
  assert.ok(existsSync(workerScript()), workerScript());
});

test('O5 profile: "Originality 72" is one small line under the Shipping ring, no second ring', () => {
  const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  assert.match(h, /Originality <span[^>]*>72<\/span>/);
  assert.equal((h.match(/role="img" aria-label="Shipping/g) ?? []).length, 1, 'one ring');
  assert.doesNotMatch(h, /aria-label="Originality/, 'no Originality ring');
  const none = renderToStaticMarkup(React.createElement(BenchProfileView, { data: { ...DATA, originality: null }, tab: 'log' }));
  assert.doesNotMatch(none, /Originality/);
});

// ---- the step ----

/** A signed-in person whose agent named `key` as the one project, then the App setup proved it (as v214-app-proof). */
async function connected(key: string, handle: string, gh: FakeGitHub, inst: number) {
  const t = `ek_orig_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const a = await attachToX(own, { id: `97${RUN}${inst}`, username: `${handle}${RUN}`.slice(0, 15), name: handle, avatar: null }, NOW);
  assert.ok(a.ok);
  const c = (await connectInstallation(t))!;
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }), readerDeps } as never;
  await mcpCall(ctx, 'find', { identity: { project: { name: key.split('/')[1], repo: `https://github.com/${key}` } } });
  const nonce = new URL(await createVerifyLink({ installationId: c.id, projectId: null, repoKey: key, purpose: 'app' }, NOW)).searchParams.get('n')!;
  await sql()`UPDATE github_verify_nonces SET login = ${`${handle}${RUN}`}, account_created_at = '2020-01-01', public_repos = 3 WHERE nonce_hash = ${sha(nonce)}`;
  const res = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=${inst}&state=${nonce}`, { headers: { cookie: `${csrfCookieName(nonce)}=x` } }), { fetch: gh, limit: async () => {} });
  assert.equal(res.status, 200);
  return { id: c.id, ctx, key };
}
const ago = (weeks: number) => new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();
const repo = (id: number, owner: string, inst: number, readme: string, extra: Partial<FakeRepo> = {}): FakeRepo =>
  ({ id, owner, installation: inst, private: true, commits: [{ sha: `c${id}`, message: 'x', date: ago(0) }], readme, ...extra });
const rowOf = async (key: string) => (await sql()<{ builder_id: number; originality: number | null; nearest: Record<string, unknown>[]; text_hash: string | null; computed_at: Date | null; checked_at: Date }[]>`
  SELECT builder_id, originality, nearest, text_hash, computed_at, checked_at FROM project_embeddings WHERE project_key = ${key.toLowerCase()}`)[0];

const FRIDGE = '# Fridge planner\nPhotograph your fridge and receive weekly dinner plans with shopping lists, tailored to allergies.';
const FRIDGE_TWIN = '# Fridge planner clone\nPhotograph your fridge and receive weekly dinner plans with shopping lists, tailored to allergies.';
const ORBIT = '# Orbit\nSatellite telemetry decoder streaming ionosphere measurements into amateur radio dashboards.';

test('O6 the step: a new project gets Originality; a close one arriving later lowers the earlier one; the same text is never embedded again', db, async () => {
  const a = `ana${RUN}/fridge`;
  const b = `ben${RUN}/fridge-clone`;
  const c = `cy${RUN}/orbit`;
  const gh = fakeGitHub({
    [a]: repo(9301, `ana${RUN}`, 301, FRIDGE),
    [b]: repo(9302, `ben${RUN}`, 302, FRIDGE_TWIN),
    [c]: repo(9303, `cy${RUN}`, 303, ORBIT),
  });
  const pa = await connected(a, 'ana', gh, 301);
  const embed = fakeEmbed();
  // Before the step: no Originality anywhere.
  assert.equal(await readOriginality(pa.id, a), null);
  const r1 = await originalityStep(NOW, { deadline: far(), only: [pa.id], ghFetch: gh, embed });
  assert.deepEqual(r1, { checked: 1, embedded: 1, updated: 1 });
  const first = (await rowOf(a))!;
  assert.ok(first.originality! >= 80, `alone, far from every known idea: ${first.originality}`);
  // The README was read with the installation's token.
  const readme = gh.calls.filter((x) => x.path === `/repos/${a}/readme`);
  assert.equal(readme.length, 1);
  assert.equal(readme[0].auth, 'Bearer ghs_fake_301');
  // The known ideas are embedded once and cached.
  const [{ n: ideas }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM known_idea_embeddings`;
  assert.ok(ideas >= 50, String(ideas));

  // The same run again: nothing is due (checked within the week, same description).
  const r2 = await originalityStep(NOW, { deadline: far(), only: [pa.id], ghFetch: gh, embed });
  assert.deepEqual(r2, { checked: 0, embedded: 0, updated: 0 });

  // A near copy arrives from another builder: it scores low, and the earlier project drops too.
  const pb = await connected(b, 'ben', gh, 302);
  const calls = embed.calls.length;
  const r3 = await originalityStep(NOW, { deadline: far(), only: [pb.id], ghFetch: gh, embed });
  assert.deepEqual(r3, { checked: 1, embedded: 1, updated: 2 });
  assert.equal(embed.calls.length, calls + 1, 'one embed call: the ideas came from the cache');
  const twin = (await rowOf(b))!;
  const earlier = (await rowOf(a))!;
  assert.ok(twin.originality! <= 20, String(twin.originality));
  assert.ok(earlier.originality! <= 20, `the earlier project dropped: ${earlier.originality}`);
  assert.deepEqual(earlier.nearest[0], { kind: 'project', key: b, similarity: (earlier.nearest[0] as { similarity: number }).similarity });

  // An unrelated project: high, and it changes nobody else's Originality.
  const pc = await connected(c, 'cy', gh, 303);
  const r4 = await originalityStep(NOW, { deadline: far(), only: [pc.id], ghFetch: gh, embed });
  assert.equal((r4 as { embedded: number }).embedded, 1);
  assert.ok((await rowOf(c))!.originality! >= 80);
  assert.equal((await rowOf(a))!.originality, earlier.originality);

  // The weekly README check with the same text: read, not embedded.
  await sql()`UPDATE project_embeddings SET checked_at = ${new Date(NOW.getTime() - 8 * 86_400_000)} WHERE project_key = ${a}`;
  const before = embed.calls.length;
  const r5 = await originalityStep(NOW, { deadline: far(), only: [pa.id], ghFetch: gh, embed });
  assert.deepEqual(r5, { checked: 1, embedded: 0, updated: 0 });
  assert.equal(embed.calls.length, before);
  assert.ok((await rowOf(a))!.checked_at.getTime() >= NOW.getTime() - 1000);

  // The README changes: on the next weekly check it is embedded again.
  gh.repos[a].readme = ORBIT.replace('Orbit', 'Orbit two');
  await sql()`UPDATE project_embeddings SET checked_at = ${new Date(NOW.getTime() - 8 * 86_400_000)} WHERE project_key = ${a}`;
  const r6 = await originalityStep(NOW, { deadline: far(), only: [pa.id], ghFetch: gh, embed });
  assert.equal((r6 as { embedded: number }).embedded, 1);
});

test('O7 the due query: a changed description is due at once; the same one is not; a failed README read keeps the vector', db, async () => {
  const k = `dee${RUN}/notes`;
  const gh = fakeGitHub({ [k]: repo(9311, `dee${RUN}`, 311, '# Notes\nQuantum lattice notebook for glacier hydrology.') });
  const p = await connected(k, 'dee', gh, 311);
  const embed = fakeEmbed();
  await originalityStep(NOW, { deadline: far(), only: [p.id], ghFetch: gh, embed });
  const h1 = (await rowOf(k))!.text_hash;
  assert.ok(h1);
  // Same description: not due.
  assert.equal((await originalityStep(NOW, { deadline: far(), only: [p.id], ghFetch: gh, embed }) as { checked: number }).checked, 0);
  // The description changes: due now (not in a week), embedded, the hash moves.
  await sql()`UPDATE builder_projects SET what = 'Glacier melt notebook' WHERE builder_id = ${p.id}`;
  const r = await originalityStep(NOW, { deadline: far(), only: [p.id], ghFetch: gh, embed });
  assert.deepEqual(r, { checked: 1, embedded: 1, updated: 1 });
  const h2 = (await rowOf(k))!.text_hash;
  assert.notEqual(h2, h1);
  assert.ok(embed.calls.at(-1)![0].startsWith('Glacier melt notebook\n'), 'the description comes first');
  // The README read fails (500) at the weekly check, description unchanged: the vector stays.
  const md = gh.repos[k].readme;
  gh.repos[k].readme = null;
  await sql()`UPDATE project_embeddings SET checked_at = ${new Date(NOW.getTime() - 8 * 86_400_000)} WHERE project_key = ${k}`;
  const r2 = await originalityStep(NOW, { deadline: far(), only: [p.id], ghFetch: gh, embed });
  assert.deepEqual(r2, { checked: 1, embedded: 0, updated: 0 });
  assert.equal((await rowOf(k))!.text_hash, h2);
  assert.ok(md);
  // Fix round 1 (5): the README is deleted (404): re-embedded from the description alone.
  delete gh.repos[k].readme;
  await sql()`UPDATE project_embeddings SET checked_at = ${new Date(NOW.getTime() - 8 * 86_400_000)} WHERE project_key = ${k}`;
  const r3 = await originalityStep(NOW, { deadline: far(), only: [p.id], ghFetch: gh, embed });
  assert.deepEqual(r3, { checked: 1, embedded: 1, updated: 1 });
  assert.equal(embed.calls.at(-1)![0], 'Glacier melt notebook');
  assert.notEqual((await rowOf(k))!.text_hash, h2);
  // Past the deadline: nothing is checked.
  await sql()`UPDATE builder_projects SET what = 'Another description' WHERE builder_id = ${p.id}`;
  assert.deepEqual(await originalityStep(NOW, { deadline: Date.now() - 1, only: [p.id], ghFetch: gh, embed }), { checked: 0, embedded: 0, updated: 0 });
  // The App off: skipped.
  const id = process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_ID;
  try {
    assert.deepEqual(await originalityStep(NOW, { deadline: far(), ghFetch: gh, embed }), { step: 'skipped' });
  } finally {
    process.env.GITHUB_APP_ID = id;
  }
});

test('O7b fix rounds 1 and 2: a hung embed is cut at the deadline (nothing stamped, due next hour); a failed embed writes nothing and the next run retries', db, async () => {
  const k1 = `hal${RUN}/one`;
  const k2 = `ivy${RUN}/two`;
  const gh = fakeGitHub({
    [k1]: repo(9341, `hal${RUN}`, 341, '# One\nVolcanic ash dispersion forecaster for regional airports.'),
    [k2]: repo(9342, `ivy${RUN}`, 342, '# Two\nBeekeeping hive acoustics classifier for swarm alerts.'),
  });
  const p1 = await connected(k1, 'hal', gh, 341);
  const p2 = await connected(k2, 'ivy', gh, 342);
  // A loader that never answers: the step returns at the deadline, writes nothing, and both stay due.
  const hung: Embed = () => new Promise(() => {});
  const t0 = Date.now();
  const r = await originalityStep(NOW, { deadline: Date.now() + 300, only: [p1.id, p2.id], ghFetch: gh, embed: hung });
  assert.ok(Date.now() - t0 < 2000, `returned in ${Date.now() - t0} ms`);
  assert.deepEqual(r, { checked: 2, embedded: 0, updated: 0 });
  assert.equal(await rowOf(k1), undefined, 'nothing stamped');
  assert.equal(await rowOf(k2), undefined);
  // The step's one embed call (one child process) fails: nothing is written, both stay due.
  const boom: Embed = async () => { throw new Error('onnx: boom'); };
  assert.deepEqual(await originalityStep(NOW, { deadline: far(), only: [p1.id, p2.id], ghFetch: gh, embed: boom }), { checked: 2, embedded: 0, updated: 0 });
  assert.equal(await rowOf(k1), undefined);
  // The next run embeds both in one call (the ideas, cached by now or not, ride along).
  const good = fakeEmbed();
  const r3 = await originalityStep(NOW, { deadline: far(), only: [p1.id, p2.id], ghFetch: gh, embed: good });
  assert.equal((r3 as { embedded: number }).embedded, 2);
  assert.equal(good.calls.length, 1, 'one embed call a step');
  assert.ok((await rowOf(k1))!.originality != null && (await rowOf(k2))!.originality != null);
});

test('O7c fix round 1: boundedEmbed rejects at the deadline', async () => {
  await assert.rejects(boundedEmbed(() => new Promise(() => {}), Date.now() + 20)(['x']), EmbedDeadline);
  await assert.rejects(boundedEmbed(fakeEmbed(), Date.now() - 1)(['x']), EmbedDeadline);
  assert.equal((await boundedEmbed(fakeEmbed(), Date.now() + 1000)(['abcd']))[0].length, DIMS);
});

test('O7d fix round 2: the worker process: output parsed, killed at the deadline, a nonzero exit or bad output rejects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ek-embed-'));
  const script = (name: string, body: string) => {
    const f = join(dir, name);
    writeFileSync(f, body);
    return f;
  };
  // Echoes one 384-number vector per text read from stdin; also writes its pid so the test can see it is gone.
  const echo = script('echo.mjs', `let s='';for await (const c of process.stdin) s+=c;const t=JSON.parse(s);
process.stdout.write(JSON.stringify(t.map((x)=>Array.from({length:${DIMS}},(_, i)=>i===x.length%${DIMS}?1:0))));`);
  const hang = script('hang.mjs', `import { writeFileSync } from 'node:fs';writeFileSync(${JSON.stringify(join(dir, 'pid'))}, String(process.pid));setInterval(()=>{},1000);`);
  const fail = script('fail.mjs', 'process.exit(3);');
  const junk = script('junk.mjs', "process.stdout.write('[1,2');");
  const off = process.env.EARNKIT_EMBED_OFF;
  delete process.env.EARNKIT_EMBED_OFF;
  try {
    const v = await workerEmbed({ deadline: far(), script: echo })(['ab', 'abc']);
    assert.equal(v.length, 2);
    assert.equal(v[0].length, DIMS);
    assert.equal(v[1][3], 1);
    const t0 = Date.now();
    await assert.rejects(workerEmbed({ deadline: Date.now() + 400, script: hang })(['x']), EmbedDeadline);
    assert.ok(Date.now() - t0 < 2000);
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the child was killed');
    await assert.rejects(workerEmbed({ deadline: far(), script: fail })(['x']), /exited 3/);
    await assert.rejects(workerEmbed({ deadline: far(), script: junk })(['x']));
    await assert.rejects(workerEmbed({ deadline: Date.now() - 1, script: echo })(['x']), EmbedDeadline);
  } finally {
    if (off !== undefined) process.env.EARNKIT_EMBED_OFF = off;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('O8 privacy: a private README is never stored as text; the nearest list names other projects by key only', db, async () => {
  const k = `eve${RUN}/secret`;
  const other = `fay${RUN}/secret-twin`;
  const MARK = 'Zanzibarquux';
  const text = `# ${MARK}\nPrivate payroll reconciliation engine ${MARK} for marine logistics firms.`;
  const gh = fakeGitHub({ [k]: repo(9321, `eve${RUN}`, 321, text), [other]: repo(9322, `fay${RUN}`, 322, text) });
  const p = await connected(k, 'eve', gh, 321);
  const q = await connected(other, 'fay', gh, 322);
  const embed = fakeEmbed();
  await originalityStep(NOW, { deadline: far(), only: [p.id, q.id], ghFetch: gh, embed });
  const [{ n }] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM project_embeddings e WHERE row_to_json(e)::text ILIKE ${`%${MARK}%`} OR row_to_json(e)::text ILIKE '%payroll%'`;
  assert.equal(n, 0, 'no README words in any column');
  const [{ m }] = await sql()<{ m: number }[]>`SELECT count(*)::int AS m FROM known_idea_embeddings WHERE idea ILIKE ${`%${MARK}%`}`;
  assert.equal(m, 0);
  for (const key of [k, other]) {
    const near = (await rowOf(key))!.nearest;
    for (const x of near) {
      if (x.kind === 'project') assert.deepEqual(Object.keys(x).sort(), ['key', 'kind', 'similarity']);
      else assert.deepEqual(Object.keys(x).sort(), ['kind', 'similarity', 'title']);
    }
  }
  // The other builder's project is their nearest; each sees only their own number.
  assert.equal((await rowOf(k))!.nearest[0].key, other);
  assert.equal(await readOriginality(q.id, k), null, "never another builder's row");
});

test('O9 shown: the profile carries "Originality N" once computed, never before; v3.1 F4: the score reply never does', db, async () => {
  // v3.1 F3: the pool reaches RANK_MIN_POOL, so a rank shows.
  await padPool(9);
  const k = `gus${RUN}/kiln`;
  const gh = fakeGitHub({ [k]: repo(9331, `gus${RUN}`, 331, '# Kiln\nCeramic kiln firing scheduler with thermocouple logging.') });
  const p = await connected(k, 'gus', gh, 331);
  const before = String((await mcpCall(p.ctx, 'score', {})).reply?.show_to_builder);
  assert.doesNotMatch(before, /Originality/);
  assert.equal((await profileData(p.id, new Date()))!.originality, null);
  await originalityStep(NOW, { deadline: far(), only: [p.id], ghFetch: gh, embed: fakeEmbed() });
  const n = (await rowOf(k))!.originality!;
  const text = String((await mcpCall(p.ctx, 'score', {})).reply?.show_to_builder);
  assert.match(text, /^Kiln: Shipping \d+ · .+ builders?\.$/m, text);
  assert.doesNotMatch(text, /Originality/, text);
  assert.equal((await profileData(p.id, new Date()))!.originality, n);
});

test('O10 opt-in (EARNKIT_MODEL_TEST=1): the real model scores two near-identical texts closer than two unrelated ones', { skip: process.env.EARNKIT_MODEL_TEST !== '1' && 'set EARNKIT_MODEL_TEST=1' }, async () => {
  // The real path: one child process running embed-worker.mjs (the model loads there, never here).
  const rss = process.memoryUsage().rss;
  const [a, b, c] = await workerEmbed({ deadline: Date.now() + 5 * 60_000 })([
    'A todo list app to track your daily tasks and reminders.',
    'A simple to-do app for tracking daily tasks with reminders.',
    'Satellite telemetry decoder for amateur radio operators.',
  ]);
  assert.equal(a.length, DIMS);
  assert.ok(cosine(a, b) > cosine(a, c) + 0.3, `${cosine(a, b)} vs ${cosine(a, c)}`);
  assert.ok(originalityOf(cosine(a, b)) < originalityOf(cosine(a, c)));
  const grew = (process.memoryUsage().rss - rss) / 1e6;
  assert.ok(grew < 60, `the parent grew ${grew.toFixed(0)} MB`);
});
