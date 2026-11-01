import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from './db';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { programProblems } from './program-checks';
import { ProgramFile, categoryOf, isOptimismUrl } from './program-file';
import { proofHostAllowed } from './submit-hosts';
import { listPrograms, upsertProgram } from './programs';
import {
  PROGRAMS_BODY_MAX,
  apiRuleProblems,
  curatedLine,
  forbiddenFields,
  noteFileTakeover,
  probeLink,
  programsWritePost,
  type WriteDeps,
} from './programs-api';
import { HttpStatusError, SafeFetchError, safeProbe, type Transport } from './safe-fetch';
import { LIMITS, RateLimitError } from './rate-limit';
import { readStats } from './stats';

const db = { skip: !process.env.DATABASE_URL };
const PROGRAMS = join(import.meta.dirname, '../../../../programs');
const PUBLIC = join(import.meta.dirname, '../../public');
const file = (name: string): ProgramFile => ProgramFile.parse(JSON.parse(readFileSync(join(PROGRAMS, `${name}.json`), 'utf8')));

after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});

test('v4.9 T1: programProblems finds nothing in any committed program file', () => {
  const names = readdirSync(PROGRAMS).filter((f) => f.endsWith('.json'));
  assert.ok(names.length > 0);
  for (const f of names) assert.deepEqual(programProblems(file(f.replace(/\.json$/, '')), { publicDir: PUBLIC }), [], f);
});

test('v4.9 T1: programProblems prints what programs:check printed (a missing todo, an optimism.io submission_url)', () => {
  // Captured from `pnpm programs:check` before the refactor, on a copy of base-builder-grants with no todo on its
  // required items, no kind on its first item and no needs_repo.
  const base = committedProgram('base-builder-grants');
  const noTodo = structuredClone(base);
  for (const r of noTodo.submission_requirements) if (r.required) delete r.todo;
  delete noTodo.submission_requirements[0].kind;
  delete noTodo.needs_repo;
  const keys = (base.submission_requirements as { key: string; required: boolean }[]).filter((r) => r.required).map((r) => r.key);
  assert.deepEqual(programProblems(ProgramFile.parse(noTodo), { publicDir: PUBLIC }), [
    `submission_requirements: add a "todo" to each required item (${keys.join(', ')})`,
    `submission_requirements: add a "kind" to each item (${base.submission_requirements[0].key})`,
    'needs_repo: say whether entering needs a repo or a live product (true or false)',
  ]);

  // An object that never went through the schema is still held to its rules (the API's case).
  const optimism = { ...file('a16z-speedrun'), submission_url: 'https://app.optimism.io/grants' };
  assert.deepEqual(programProblems(optimism, { publicDir: PUBLIC }), ['(program): Optimism programs are not listed']);
  // base-builder-grants also has a form, so its submit host changing adds the script's form line after it.
  assert.deepEqual(programProblems({ ...file('base-builder-grants'), submission_url: 'https://app.optimism.io/grants' }, { publicDir: PUBLIC }), [
    '(program): Optimism programs are not listed',
    '(program): form is only for a Google, Airtable or Tally form on the submit host',
  ]);

  // The logo file, and the schema's shared-host and any_chain rules.
  assert.deepEqual(programProblems({ ...file('base-builder-grants'), id: 'tmp-v49-c', logo: { ...file('base-builder-grants').logo!, path: 'programs/tmp-v49-c.svg' } }, { publicDir: PUBLIC }), [
    'logo.path: programs/tmp-v49-c.svg not found under apps/frontend/public',
  ]);
  assert.deepEqual(programProblems({ ...file('a16z-speedrun'), proof_hosts: ['github.com/'] }, { publicDir: PUBLIC }), [
    'proof_hosts.0: not a shared host, a public suffix or earnkit.com',
  ]);
  assert.ok(programProblems({ ...file('a16z-speedrun'), chains: [], any_chain: true, min_product_score: 0 }, { publicDir: PUBLIC }).includes(
    '(program): any_chain programs need min_product_score of 5 or more',
  ));
});

test('v4.9 T1: categoryOf derives investment, grant and hackathon; an explicit category wins', () => {
  assert.equal(categoryOf(file('a16z-speedrun')), 'investment');
  assert.equal(categoryOf(file('base-builder-grants')), 'grant');
  assert.equal(categoryOf(file('ethglobal-mumbai')), 'hackathon', 'in person');
  const poolOnly = { ...file('arc-microgrants'), max_award_usd: undefined, min_award_usd: undefined, pitch: undefined };
  assert.equal(poolOnly.pool_usd !== undefined, true);
  assert.equal(categoryOf(poolOnly), 'hackathon', 'a pool with no per-winner amount');
  assert.equal(categoryOf({ ...file('a16z-speedrun'), category: 'bounty' }), 'bounty');
  assert.equal(categoryOf({ ...file('base-builder-grants'), category: 'hackathon' }), 'hackathon');
  assert.equal(ProgramFile.safeParse({ ...committedProgram('base-builder-grants'), category: 'prize' }).success, false);
});

test("v4.9 T1: upsertProgram(p, 'api') stores source 'api' and the category; a file sync stores its category", db, async () => {
  const id = `v49-api-${process.pid}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('a16z-speedrun'), id }), 'api');
  const [row] = await sql()<{ source: string; category: string }[]>`SELECT source, category FROM programs WHERE id = ${id}`;
  assert.deepEqual({ ...row }, { source: 'api', category: 'investment' });

  await upsertProgram(ProgramFile.parse({ ...committedProgram('a16z-speedrun'), id, category: 'bounty' }), 'api');
  const [again] = await sql()<{ category: string }[]>`SELECT category FROM programs WHERE id = ${id}`;
  assert.equal(again.category, 'bounty');

  const fileId = `v49-file-${process.pid}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('base-builder-grants'), id: fileId }));
  const [f] = await sql()<{ source: string; category: string }[]>`SELECT source, category FROM programs WHERE id = ${fileId}`;
  assert.deepEqual({ ...f }, { source: 'file', category: 'grant' });
});

test('v4.9 T1: program_writes exists with its columns', db, async () => {
  const cols = await sql()<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'program_writes' ORDER BY ordinal_position`;
  assert.deepEqual(cols.map((c) => c.column_name), ['id', 'at', 'program_id', 'action', 'result', 'reason', 'body']);
});

// ---- v4.9 Task 2: the write API (programs-api.ts, POST /api/programs/write) ----

const TOKEN = randomBytes(32).toString('hex');
const today = new Date().toISOString().slice(0, 10);
const noNet = { checkLink: async () => {}, programsDir: PROGRAMS, limit: async () => {} };
const withToken = <T>(fn: () => Promise<T>, env: Record<string, string | undefined> = { EARNKIT_PROGRAMS_TOKEN: TOKEN }) => async () => {
  const keep = { t: process.env.EARNKIT_PROGRAMS_TOKEN, a: process.env.EARNKIT_PROGRAMS_API };
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_PROGRAMS_API;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try {
    await fn();
  } finally {
    for (const [k, v] of [['EARNKIT_PROGRAMS_TOKEN', keep.t], ['EARNKIT_PROGRAMS_API', keep.a]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
};
/** A valid API program: a16z-speedrun without the owner-only fields, rolling, checked today. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiProgram = (id: string, o: Record<string, unknown> = {}): any => {
  const p = committedProgram('a16z-speedrun');
  delete p.proof_hosts;
  delete p.x_handles;
  // Fix round 0: owner-only too.
  delete p.starters;
  delete p.difficulty_override;
  return { ...p, id, ends_at: null, verified_at: today, ...o };
};
const req = (body: unknown, o: { auth?: string | null } = {}) =>
  new Request('http://localhost/api/programs/write', {
    method: 'POST',
    headers: {
      ...(o.auth === null ? {} : { authorization: o.auth ?? `Bearer ${TOKEN}` }),
      'content-type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const send = async (body: unknown, deps: WriteDeps = noNet, o: { auth?: string | null } = {}) => {
  const res = await programsWritePost(req(body, o), deps);
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 404 is plain text.
  }
  return { status: res.status, body: parsed as { ok: boolean; problems?: string[]; result?: string; category?: string; live?: boolean; id?: string; error?: string }, headers: res.headers };
};
const writes = (id: string) =>
  sql()<{ action: string; result: string; reason: string | null; body: unknown }[]>`
    SELECT action, result, reason, body FROM program_writes WHERE program_id = ${id} ORDER BY id`;

test('v4.9 T2: 404 while the token is unset, too short, or EARNKIT_PROGRAMS_API=off (even with the token)', async () => {
  await withToken(async () => assert.equal((await send({ action: 'close', id: 'x-y-z', reason: 'r' })).status, 404), {})();
  await withToken(async () => assert.equal((await send({ action: 'close', id: 'x-y-z', reason: 'r' }, noNet, { auth: 'Bearer short' })).status, 404), {
    EARNKIT_PROGRAMS_TOKEN: 'short',
  })();
  await withToken(async () => assert.equal((await send({ action: 'close', id: 'x-y-z', reason: 'r' })).status, 404), {
    EARNKIT_PROGRAMS_TOKEN: TOKEN,
    EARNKIT_PROGRAMS_API: 'off',
  })();
});

test('v4.9 T2: 401 for a missing or wrong token, of any length (equal-length sha256 digests, never a throw)', withToken(async () => {
  const body = { action: 'close', id: 'x-y-z', reason: 'r' };
  assert.equal((await send(body, noNet, { auth: null })).status, 401);
  assert.equal((await send(body, noNet, { auth: `Bearer ${randomBytes(32).toString('hex')}` })).status, 401, 'same length');
  assert.equal((await send(body, noNet, { auth: 'Bearer x' })).status, 401, 'shorter');
  assert.equal((await send(body, noNet, { auth: `Bearer ${TOKEN}${TOKEN}` })).status, 401, 'longer');
  assert.equal((await send(body, noNet, { auth: TOKEN })).status, 401, 'no Bearer');
  // The compare: programs-api uses http.ts bearerMatches, whose secretMatches hashes both sides to 32 bytes first.
  const api = readFileSync(join(import.meta.dirname, 'programs-api.ts'), 'utf8');
  assert.match(api, /bearerMatches\(request\.headers\.get\('authorization'\), process\.env\.EARNKIT_PROGRAMS_TOKEN\)/);
  const http = readFileSync(join(import.meta.dirname, 'http.ts'), 'utf8');
  assert.match(http, /timingSafeEqual\(\s*createHash\('sha256'\)\.update\(given\)\.digest\(\),\s*createHash\('sha256'\)\.update\(secret\)\.digest\(\),?\s*\)/);
}));

test('v4.9 T2: 429 over the rate limit (120 an hour, the repo limiter), after the token check', withToken(async () => {
  assert.deepEqual(LIMITS.programsWrite, { limit: 120, windowSeconds: 3_600 });
  let counted = 0;
  const over = { ...noNet, limit: async () => { counted++; throw new RateLimitError('Too many program writes this hour.', 600); } };
  const r = await send({ action: 'close', id: 'x-y-z', reason: 'r' }, over);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '600');
  assert.equal((await send({ action: 'close', id: 'x-y-z', reason: 'r' }, over, { auth: 'Bearer nope' })).status, 401);
  assert.equal(counted, 1, 'an unauthenticated call never counts');
}));

test('v4.9 T2: 413 over 256 KB; 400 for a body that is not JSON, deeply nested (1,000 levels) or the wrong shape', db, withToken(async () => {
  assert.equal(PROGRAMS_BODY_MAX, 262_144);
  const big = JSON.stringify({ action: 'upsert', program: { ...apiProgram(`v49-big-${process.pid}`), description: 'x'.repeat(PROGRAMS_BODY_MAX) } });
  assert.equal((await send(big)).status, 413);
  const notJson = await send('{"action":');
  assert.deepEqual([notJson.status, notJson.body.problems], [400, ['body: not JSON']]);
  const deep = (n: number) => '['.repeat(n) + ']'.repeat(n);
  for (const body of [
    `{"action":"upsert","program":${deep(1000)}}`,
    `{"action":"upsert","program":{"id":"v49-deep-${process.pid}","description":${deep(1000)}}}`,
    `{"action":"upsert","program":${JSON.stringify(apiProgram(`v49-deep-${process.pid}`)).slice(0, -1)},"extra":${deep(1000)}}}`,
    `{"action":"upsert","nest":${deep(1000)}}`,
    deep(1000),
    '"upsert"',
    'null',
    JSON.stringify({ action: 'delete', id: 'abc' }),
  ]) {
    const r = await send(body);
    assert.equal(r.status, 400, body.slice(0, 60));
    assert.ok(r.body.problems!.length > 0);
  }
  assert.equal((await sql()`SELECT 1 FROM programs WHERE id = ${`v49-deep-${process.pid}`}`).length, 0);
}));

test('v4.9 T2: each owner-only field (R4) is refused with 400, and so is a programs:check problem', db, withToken(async () => {
  const id = `v49-r4-${process.pid}`;
  const logo = { path: `programs/${id}.svg`, source_url: 'https://speedrun.a16z.com/' };
  for (const [k, v] of [['proof_hosts', ['speedrun.a16z.com/']], ['x_handles', ['speedrun']], ['logo', logo], ['proof_hosts', []]] as const) {
    const r = await send({ action: 'upsert', program: apiProgram(id, { [k]: v }) });
    assert.equal(r.status, 400, k);
    assert.ok(r.body.problems!.includes(`${k}: the API can't set ${k}; the owner adds it by file`), k);
  }
  // Fix round 0: campaign (it pays out) and the other owner-only fields; agent_completable stays allowed.
  for (const [k, v] of [
    ['campaign', { kind: 'earnkit' }],
    ['fresh_build', { starter: 'arc-tipjar' }],
    ['starters', []],
    ['difficulty_override', committedProgram('a16z-speedrun').difficulty_override],
  ] as const) {
    const r = await send({ action: 'upsert', program: apiProgram(id, { [k]: v }) });
    assert.equal(r.status, 400, k);
    assert.ok(r.body.problems!.includes(`${k}: the API can't set ${k}; the owner adds it by file`), k);
  }
  const ac = await send({ action: 'upsert', program: apiProgram(`v49-ac-${process.pid}`, { agent_completable: true }) });
  assert.deepEqual([ac.status, ac.body.result], [200, 'created']);
  // programs:check's rules (group 3): a required item without its todo.
  const p = apiProgram(id);
  delete p.submission_requirements[0].todo;
  const noTodo = await send({ action: 'upsert', program: p });
  assert.equal(noTodo.status, 400);
  assert.match(noTodo.body.problems![0], /add a "todo"/);
  assert.equal((await sql()`SELECT 1 FROM programs WHERE id = ${id}`).length, 0, 'nothing written');
  const audit = await writes(id);
  assert.ok(audit.length > 0 && audit.every((w) => w.result === 'refused' && w.body === null), 'refusals are kept, never their body');
}));

test('v4.9 T2: the API-only rules (group 4)', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const ok = ProgramFile.parse(apiProgram('v49-rules', { verified_at: '2026-11-01' }));
  assert.deepEqual(apiRuleProblems(ok, now), []);
  const at = (o: Record<string, unknown>) => apiRuleProblems({ ...ok, ...o } as ProgramFile, now);
  assert.deepEqual(at({ id: 'ab' }), ['id: 3 to 64 lowercase letters, digits or dashes']);
  assert.deepEqual(at({ id: 'a'.repeat(65) }), ['id: 3 to 64 lowercase letters, digits or dashes']);
  assert.deepEqual(at({ verified_at: '2026-10-25' }), [], '7 days is fine');
  assert.deepEqual(at({ verified_at: '2026-10-24' }), ['verified_at: more than 7 days ago; check the source again']);
  assert.deepEqual(at({ verified_at: '2026-11-02' }), [], "UTC+14's today");
  assert.deepEqual(at({ verified_at: '2026-11-03' }), ['verified_at: is in the future']);
  assert.deepEqual(at({ ends_at: '2026-11-01T11:59:59Z' }), ['ends_at: has passed; an active program needs a future ends_at or null']);
  assert.deepEqual(at({ ends_at: '2026-11-01T11:59:59Z', status: 'closed' }), [], 'a closed program may have ended');
  assert.deepEqual(at({ ends_at: '2026-11-02T00:00:00Z' }), []);
  assert.deepEqual(at({ source_url: 'http://speedrun.a16z.com/faq' }), ['source_url: must be https']);
  // Fix round 0: program pages may be on shared hosts (real programs submit on forms, DoraHacks, Questbook).
  assert.deepEqual(at({ submission_url: 'https://dorahacks.io/hackathon/x' }), []);
  assert.deepEqual(at({ submission_url: 'https://docs.google.com/forms/d/e/x/viewform' }), []);
  assert.deepEqual(at({ source_url: 'https://foo.github.io/p' }), []);
  assert.deepEqual(at({ submission_url: 'http://circle.questbook.app/' }), ['submission_url: must be https']);
  assert.deepEqual(at({ source_url: 'https://gov.optimism.io/x' }), ['source_url: Optimism programs are not listed']);
  assert.deepEqual(forbiddenFields({ logo: null, x_handles: undefined, title: 't' }), ['x_handles', 'logo']);
});

test('v4.9 T2: a past ends_at on an active program, and a link that does not load, are refused with nothing written', db, withToken(async () => {
  const id = `v49-past-${process.pid}`;
  const past = await send({ action: 'upsert', program: apiProgram(id, { ends_at: '2026-01-01T00:00:00Z' }) });
  assert.equal(past.status, 400);
  assert.deepEqual(past.body.problems, ['ends_at: has passed; an active program needs a future ends_at or null']);
  const probed: string[] = [];
  const failing = { ...noNet, checkLink: async (url: string) => { probed.push(url); if (url.endsWith('/apply')) throw new Error("couldn't fetch it (404)"); } };
  const dead = await send({ action: 'upsert', program: apiProgram(id) }, failing);
  assert.equal(dead.status, 400);
  assert.deepEqual(dead.body.problems, ["submission_url: doesn't load (couldn't fetch it (404))"]);
  assert.deepEqual(probed, ['https://speedrun.a16z.com/faq', 'https://speedrun.a16z.com/apply']);
  assert.equal((await sql()`SELECT 1 FROM programs WHERE id = ${id}`).length, 0);
  // An upcoming program may share one URL for both: probed once.
  probed.length = 0;
  const upcoming = apiProgram(id, { status: 'upcoming', opens_note: 'Opens in December', submission_url: 'https://speedrun.a16z.com/faq', submission_requirements: [] });
  const r = await send({ action: 'upsert', program: upcoming }, { ...failing });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(probed, ['https://speedrun.a16z.com/faq']);
  assert.equal(r.body.live, true);
}));

test('v4.9 T2: 409 for a curated id (a programs/ file, or a row whose source is not api), for upsert and close', db, withToken(async () => {
  const line = curatedLine('a16z-speedrun');
  const a = await send({ action: 'upsert', program: apiProgram('a16z-speedrun') });
  assert.deepEqual([a.status, a.body.problems], [409, [line]]);
  const c = await send({ action: 'close', id: 'a16z-speedrun', reason: 'ended' });
  assert.deepEqual([c.status, c.body.problems], [409, [line]]);
  // Without the directory, the row check alone holds (the synced row's source is 'file').
  const noDir = { ...noNet, programsDir: null };
  assert.equal((await send({ action: 'upsert', program: apiProgram('a16z-speedrun') }, noDir)).status, 409);
  assert.equal((await send({ action: 'close', id: 'a16z-speedrun', reason: 'ended' }, noDir)).status, 409);
  // A sponsor row too.
  const sponsor = `v49-sponsor-${process.pid}`;
  await upsertProgram(ProgramFile.parse(apiProgram(sponsor)), 'sponsor');
  assert.equal((await send({ action: 'upsert', program: apiProgram(sponsor, { title: 'Taken' }) }, noDir)).status, 409);
  assert.equal((await send({ action: 'close', id: sponsor, reason: 'x' }, noDir)).status, 409);
  const [row] = await sql()<{ title: string; status: string }[]>`SELECT title, status FROM programs WHERE id = ${sponsor}`;
  assert.deepEqual({ ...row }, { title: committedProgram('a16z-speedrun').title, status: 'active' }, 'the sponsor row is untouched');
  // And the directory alone holds, with no row yet.
  const dir = mkdtempSync(join(tmpdir(), 'v49-programs-'));
  const fresh = `v49-dir-${process.pid}`;
  writeFileSync(join(dir, `${fresh}.json`), '{}');
  assert.equal((await send({ action: 'upsert', program: apiProgram(fresh) }, { ...noNet, programsDir: dir })).status, 409);
  rmSync(dir, { recursive: true });
  assert.equal((await sql()`SELECT 1 FROM programs WHERE id = ${fresh}`).length, 0);
}));

test('v4.9 T2: created, unchanged, updated, closed, in order; find, list_programs and /api/stats include it; the audit keeps each', db, withToken(async () => {
  const id = `v49-flow-${process.pid}`;
  const before = await readStats();
  const created = await send({ action: 'upsert', program: apiProgram(id) });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.deepEqual(created.body, { ok: true, id, result: 'created', category: 'investment', live: true });
  const [row] = await sql()<{ source: string; status: string; x_handles: string[]; proof_hosts: string[] }[]>`
    SELECT source, status, x_handles, proof_hosts FROM programs WHERE id = ${id}`;
  assert.deepEqual({ ...row }, { source: 'api', status: 'active', x_handles: [], proof_hosts: [] });
  assert.ok((await listPrograms()).some((p) => p.id === id), 'list_programs lists it');
  const after = await readStats();
  assert.equal(after.programs_open, before.programs_open + 1, '/api/stats counts it');

  assert.equal((await send({ action: 'upsert', program: apiProgram(id) })).body.result, 'unchanged');
  const updated = await send({ action: 'upsert', program: apiProgram(id, { title: 'Speedrun, again', category: 'bounty' }) });
  assert.deepEqual([updated.body.result, updated.body.category], ['updated', 'bounty']);
  const [t] = await sql()<{ title: string }[]>`SELECT title FROM programs WHERE id = ${id}`;
  assert.equal(t.title, 'Speedrun, again');

  const tooLong = await send({ action: 'close', id, reason: 'x'.repeat(201) });
  assert.equal(tooLong.status, 400);
  const closed = await send({ action: 'close', id, reason: 'The cohort filled' });
  assert.deepEqual(closed.body, { ok: true, id, result: 'closed', category: 'bounty', live: false });
  assert.equal((await send({ action: 'close', id, reason: 'again' })).body.result, 'unchanged');
  assert.ok(!(await listPrograms()).some((p) => p.id === id), 'closed: no longer listed');
  const missing = await send({ action: 'close', id: `v49-none-${process.pid}`, reason: 'x' });
  assert.deepEqual([missing.status, missing.body.problems], [400, [`id: no program v49-none-${process.pid}`]]);

  const audit = await writes(id);
  assert.deepEqual(
    audit.map((w) => `${w.action} ${w.result}`),
    ['upsert created', 'upsert unchanged', 'upsert updated', 'close closed', 'close unchanged'],
  );
  assert.equal((audit[0].body as { id: string }).id, id, 'the written (parsed) program is kept');
  assert.equal(audit[1].body, null, 'unchanged: no body');
  assert.equal(audit[3].reason, 'The cohort filled');
}));

test('v4.9 T2: programs:sync afterwards leaves an api row alone; a file taking over an api row is recorded', db, withToken(async () => {
  const id = `v49-sync-${process.pid}`;
  assert.equal((await send({ action: 'upsert', program: apiProgram(id, { title: 'Kept by sync' }) })).body.result, 'created');
  execFileSync('npx', ['tsx', 'scripts/programs-sync.mts'], {
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
  const [row] = await sql()<{ source: string; title: string; status: string }[]>`SELECT source, title, status FROM programs WHERE id = ${id}`;
  assert.deepEqual({ ...row }, { source: 'api', title: 'Kept by sync', status: 'active' });

  assert.equal(await noteFileTakeover(id), true);
  assert.equal(await noteFileTakeover('a16z-speedrun'), false, 'a file row is no takeover');
  assert.equal(await noteFileTakeover(`v49-none-${process.pid}`), false);
  const last = (await writes(id)).at(-1)!;
  assert.deepEqual([last.action, last.result, last.body], ['takeover', 'file', null]);
  const script = readFileSync(join(import.meta.dirname, '../../scripts/programs-sync.mts'), 'utf8');
  assert.match(script, /if \(await noteFileTakeover\(result\.data!\.id\)\) console\.warn\(`\[programs\] file \$\{result\.data!\.id\} took over an api program`\);\n\s+await upsertProgram\(result\.data!\);/);
}));

test('v4.9 T2: the route answers 404 with the token unset and 401 with a wrong one', async () => {
  const { POST } = await import('../../app/api/programs/write/route');
  await withToken(async () => assert.equal((await POST(req({ action: 'close', id: 'x-y-z', reason: 'r' }))).status, 404), {})();
  await withToken(async () => {
    const r = await POST(req({ action: 'close', id: 'x-y-z', reason: 'r' }, { auth: 'Bearer wrong' }));
    assert.equal(r.status, 401);
  })();
});

test('v4.9 T2: logs never carry the token or a body', () => {
  const api = readFileSync(join(import.meta.dirname, 'programs-api.ts'), 'utf8');
  for (const line of api.split('\n').filter((l) => /console\.(log|warn|error)/.test(l)))
    assert.doesNotMatch(line, /TOKEN|body|text|raw|err\b|authorization/i, line.trim());
});

test('v4.9 T2 fix round 0: a Questbook submission_url is accepted', db, withToken(async () => {
  const id = `v49-qb-${process.pid}`;
  const r = await send({ action: 'upsert', program: apiProgram(id, { submission_url: 'https://circle.questbook.app/' }) });
  assert.deepEqual([r.status, r.body.result], [200, 'created'], JSON.stringify(r.body));
  const [row] = await sql()<{ submission_url: string }[]>`SELECT submission_url FROM programs WHERE id = ${id}`;
  assert.equal(row.submission_url, 'https://circle.questbook.app/');
}));

test('v4.9 T2 fix round 0: a 401, 403 or 429 probe answer passes (a bot wall); 404, 410, 5xx and network errors fail', async () => {
  const answering = (status: number) => async () => {
    throw new HttpStatusError(status);
  };
  for (const s of [401, 403, 429]) await probeLink('https://example.com/', answering(s));
  for (const s of [404, 410, 500, 502, 503]) await assert.rejects(probeLink('https://example.com/', answering(s)), new RegExp(`answered ${s}, not 2xx`));
  await assert.rejects(probeLink('https://example.com/', async () => { throw new SafeFetchError("couldn't fetch it (ECONNREFUSED)"); }), /ECONNREFUSED/);
  await assert.rejects(probeLink('https://example.com/', async () => { throw new SafeFetchError('redirects to another site (x.com)'); }), /another site/);
  await probeLink('https://example.com/', async () => {});
  // safeProbe itself: the status is on the error, the message and class unchanged for its other callers.
  const transport = (status: number): Transport => async () => ({ status, body: (async function* () {})() });
  const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
  for (const s of [403, 404]) {
    const err = await safeProbe('https://example.com/', { resolve, transport: transport(s) }).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof HttpStatusError && err instanceof SafeFetchError);
    assert.equal((err as HttpStatusError).status, s);
    assert.equal((err as Error).message, `answered ${s}, not 2xx`);
  }
  await probeLink('https://example.com/', (u) => safeProbe(u, { resolve, transport: transport(403) }));
  await assert.rejects(probeLink('https://example.com/', (u) => safeProbe(u, { resolve, transport: transport(404) })));
});

test('v4.9 T2 fix (security review): hostnames are normalized; a trailing dot or an IP literal is refused', db, withToken(async () => {
  assert.equal(isOptimismUrl('https://optimism.io./x'), true);
  assert.equal(isOptimismUrl('https://GOV.Optimism.IO../x'), true);
  assert.equal(proofHostAllowed('github.com.'), false);
  assert.equal(proofHostAllowed('GitHub.com'), false);
  const ok = ProgramFile.parse(apiProgram('v49-hosts'));
  const at = (o: Record<string, unknown>) => apiRuleProblems({ ...ok, ...o } as ProgramFile, new Date());
  assert.deepEqual(at({ source_url: 'https://optimism.io./x' }), ['source_url: no trailing dot in the host name']);
  assert.deepEqual(at({ submission_url: 'https://speedrun.a16z.com./apply' }), ['submission_url: no trailing dot in the host name']);
  const ipLine = (k: string) => [`${k}: use the program's domain name, not an IP address`];
  assert.deepEqual(at({ source_url: 'https://127.0.0.1/' }), ipLine('source_url'));
  assert.deepEqual(at({ source_url: 'https://[::1]/' }), ipLine('source_url'));
  assert.deepEqual(at({ submission_url: 'https://10.0.0.5/' }), ipLine('submission_url'));
  assert.deepEqual(at({ submission_url: 'https://0x7f.1/' }), ipLine('submission_url'), 'the URL parser normalizes it to 127.0.0.1');
  // Through the API: the schema's Optimism refusal sees through the trailing dot, and nothing is written.
  const id = `v49-dot-${process.pid}`;
  const r = await send({ action: 'upsert', program: apiProgram(id, { source_url: 'https://optimism.io./x' }) });
  assert.equal(r.status, 400);
  assert.ok(r.body.problems!.includes('(program): Optimism programs are not listed'), JSON.stringify(r.body));
  const ip = await send({ action: 'upsert', program: apiProgram(id, { submission_url: 'https://[::1]/apply' }) });
  assert.deepEqual([ip.status, ip.body.problems], [400, ipLine('submission_url')]);
  assert.equal((await sql()`SELECT 1 FROM programs WHERE id = ${id}`).length, 0);
}));

test('v4.9 T2 fix (security review): the probe refuses private, loopback, link-local and metadata addresses after DNS', async () => {
  let connected = 0;
  const transport: Transport = async () => {
    connected++;
    return { status: 200, body: (async function* () {})() };
  };
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:169.254.169.254']) {
    const resolve = async () => [{ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }];
    await assert.rejects(probeLink('https://program.example/', (u) => safeProbe(u, { resolve, transport })), /doesn't point to a public address/, address);
  }
  // One private address among public ones is enough to refuse.
  const mixed = async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '10.0.0.5', family: 4 as const }];
  await assert.rejects(probeLink('https://program.example/', (u) => safeProbe(u, { resolve: mixed, transport })), /public address/);
  assert.equal(connected, 0, 'never connected');
});
